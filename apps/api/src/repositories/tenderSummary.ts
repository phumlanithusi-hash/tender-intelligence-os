import type { SupabaseClient } from '@supabase/supabase-js'
import { tenderSummarySchema, type TenderSummary } from '@tender-os/schemas'

/**
 * Aggregate KPI counts for the Tender Radar header strip (Phase 3
 * §4). Every count is a real, server-side aggregate query
 * (`count: 'exact', head: true` — PostgREST returns only the count,
 * never the matching rows themselves) over indexed columns
 * (`tenders_status_idx`, `tenders_closing_date_idx` from Phase 2).
 * Nothing here is computed by fetching rows into the API process and
 * counting them in memory (Phase 3 §21).
 *
 * `relevant` and `priorityBid` are agency-relative — they require a
 * resolved `agencyId` (from the caller's `users` row,
 * middleware/auth.ts). When the caller has no agency yet, both are
 * `null` ("—" in the UI), never a fabricated number.
 */
export async function getTenderSummary(supabase: SupabaseClient, agencyId: string | null): Promise<TenderSummary> {
  const today = new Date().toISOString().slice(0, 10)
  const in7Days = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const last14Days = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()

  const [openResult, closingSoonResult, briefingsResult, addendaResult, estimatedValueResult] = await Promise.all([
    supabase.from('tenders').select('id', { count: 'exact', head: true }).in('status', ['OPEN', 'CLOSING_SOON']),
    supabase
      .from('tenders')
      .select('id', { count: 'exact', head: true })
      .gte('closing_date', today)
      .lte('closing_date', in7Days)
      .in('status', ['OPEN', 'CLOSING_SOON']),
    supabase
      .from('tenders')
      .select('id', { count: 'exact', head: true })
      .eq('briefing_required', true)
      .in('status', ['OPEN', 'CLOSING_SOON', 'VERIFIED', 'VERIFYING']),
    supabase.from('tender_addenda').select('tender_id', { count: 'exact', head: true }).gte('created_at', last14Days),
    supabase.from('tenders').select('estimated_value').in('status', ['OPEN', 'CLOSING_SOON']).not('estimated_value', 'is', null),
  ])

  for (const result of [openResult, closingSoonResult, briefingsResult, addendaResult, estimatedValueResult]) {
    if (result.error) throw result.error
  }

  const estimatedValueTotal = estimatedValueResult.data?.length
    ? estimatedValueResult.data.reduce((sum: number, row: { estimated_value: number | null }) => sum + (row.estimated_value ?? 0), 0)
    : null

  let relevant: number | null = null
  let priorityBid: number | null = null

  if (agencyId) {
    // PostgREST's client-side filter syntax has no subquery form, so
    // "tenders classified under one of this agency's own services" is
    // resolved in two indexed steps: the agency's own service ids
    // first (small, agency-scoped), then tenders filtered against
    // that explicit list — still no full-table scan, and an empty
    // agency service list short-circuits to zero rather than an
    // `in.()` call with no values (which PostgREST rejects).
    const agencyServices = await supabase.from('agency_services').select('service_id').eq('agency_id', agencyId)
    if (agencyServices.error) throw agencyServices.error
    const serviceIds = (agencyServices.data ?? []).map((row: { service_id: string }) => row.service_id)

    const [relevantResult, priorityResult] = await Promise.all([
      serviceIds.length === 0
        ? Promise.resolve({ count: 0, error: null })
        : supabase
            .from('tenders')
            .select('id, tender_services!inner(service_id)', { count: 'exact', head: true })
            .in('status', ['OPEN', 'CLOSING_SOON'])
            .in('tender_services.service_id', serviceIds),
      supabase
        .from('tenders')
        .select('id, tender_scores!inner(score_class)', { count: 'exact', head: true })
        .eq('tender_scores.agency_id', agencyId)
        .eq('tender_scores.score_class', 'PRIORITY_BID'),
    ])

    if (relevantResult.error) throw relevantResult.error
    if (priorityResult.error) throw priorityResult.error
    relevant = relevantResult.count ?? 0
    priorityBid = priorityResult.count ?? 0
  }

  return tenderSummarySchema.parse({
    openTenders: openResult.count ?? 0,
    relevant,
    priorityBid,
    closingWithin7Days: closingSoonResult.count ?? 0,
    briefingsRequired: briefingsResult.count ?? 0,
    addendaRecent: addendaResult.count ?? 0,
    estimatedValueTotal,
  })
}
