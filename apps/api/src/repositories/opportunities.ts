import type { SupabaseClient } from '@supabase/supabase-js'
import type { OpportunityDecisionSignal } from '@tender-os/constants'
import type { ListQuery, ListResult } from './pagination.js'

/** Tender statuses treated as "currently active" for opportunity scanning (Phase 10 gates already treat CLOSED/etc. as CLOSED deadlines). */
const ACTIVE_TENDER_STATUSES = ['OPEN', 'CLOSING_SOON'] as const

export interface OpportunityRow {
  tenderId: string
  title: string
  organisation: string | null
  province: string | null
  closingDate: string | null
  tenderStatus: string
  runId: string
  overallScore: number | null
  dataCompleteness: number | null
  decisionSignal: OpportunityDecisionSignal | null
  deadlineStatus: string | null
  completedAt: string | null
}

interface OpportunitiesFilters {
  decisionSignal?: OpportunityDecisionSignal
}

interface RawScoringRunWithTender {
  id: string
  overall_score: number | null
  data_completeness: number | null
  decision_signal: OpportunityDecisionSignal | null
  deadline_status: string | null
  completed_at: string | null
  tenders: { id: string; title: string; organisation: string | null; province: string | null; closing_date: string | null; status: string } | { id: string; title: string; organisation: string | null; province: string | null; closing_date: string | null; status: string }[] | null
}

function singleTender(embed: RawScoringRunWithTender['tenders']) {
  if (!embed) return null
  return Array.isArray(embed) ? (embed[0] ?? null) : embed
}

/**
 * Read side of the Opportunities view (the page that lists currently
 * active tenders with real, already-computed opportunity intelligence
 * — Phase 10's scoring engine, not the legacy Phase 3 `tender_scores`
 * feature). Deliberately driven from `tender_scoring_runs` rather than
 * `tenders` — an active tender that has never been scanned has no
 * intelligence to show yet, and showing it here with a fabricated or
 * default score would contradict the "no fabricated data" rule this
 * whole registry follows. `POST /api/opportunities/scan`
 * (lib/scoring/runScoring.ts) is what gives a tender a row here; this
 * function only reads what has already been computed, scoped to the
 * caller's own agency via `tender_scoring_runs`' RLS (same convention
 * as repositories/tenderScoring.ts).
 */
export async function listOpportunities(
  supabase: SupabaseClient,
  query: ListQuery,
  filters: OpportunitiesFilters = {},
): Promise<ListResult<OpportunityRow>> {
  let builder = supabase
    .from('tender_scoring_runs')
    .select('id, overall_score, data_completeness, decision_signal, deadline_status, completed_at, tenders!inner(id, title, organisation, province, closing_date, status)', {
      count: 'exact',
    })
    .eq('is_current', true)
    .eq('status', 'COMPLETED')
    .in('tenders.status', ACTIVE_TENDER_STATUSES)

  if (filters.decisionSignal) builder = builder.eq('decision_signal', filters.decisionSignal)

  builder = builder.order('overall_score', { ascending: false, nullsFirst: false })

  const { data, error, count } = await builder.range(query.offset, query.offset + query.limit - 1)
  if (error) throw error

  const rows: OpportunityRow[] = (data ?? [])
    .map((raw) => {
      const run = raw as unknown as RawScoringRunWithTender
      const tender = singleTender(run.tenders)
      if (!tender) return null
      return {
        tenderId: tender.id,
        title: tender.title,
        organisation: tender.organisation,
        province: tender.province,
        closingDate: tender.closing_date,
        tenderStatus: tender.status,
        runId: run.id,
        overallScore: run.overall_score,
        dataCompleteness: run.data_completeness,
        decisionSignal: run.decision_signal,
        deadlineStatus: run.deadline_status,
        completedAt: run.completed_at,
      } satisfies OpportunityRow
    })
    .filter((row): row is OpportunityRow => row !== null)

  return { rows, limit: query.limit, offset: query.offset, total: count ?? undefined }
}

/**
 * Write side's read helper: the page of currently-active tender ids a
 * scan batch should (re-)score, in a stable order so repeated calls
 * with an advancing `offset` make real progress rather than
 * re-processing the same page (Phase 10's `runScoring` is itself
 * idempotent for an unchanged tender, but pagination still needs a
 * stable order to ever reach the tail of the list).
 */
export async function listActiveTenderIdsForScan(
  supabase: SupabaseClient,
  range: { offset: number; limit: number },
): Promise<{ ids: string[]; total: number }> {
  const { data, error, count } = await supabase
    .from('tenders')
    .select('id', { count: 'exact' })
    .in('status', ACTIVE_TENDER_STATUSES)
    .order('id', { ascending: true })
    .range(range.offset, range.offset + range.limit - 1)

  if (error) throw error
  return { ids: (data ?? []).map((row) => (row as { id: string }).id), total: count ?? 0 }
}
