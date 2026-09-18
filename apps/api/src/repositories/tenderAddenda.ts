import type { SupabaseClient } from '@supabase/supabase-js'
import { tenderAddendumSchema, type TenderAddendumRow, addendumAcknowledgementSchema, type AddendumAcknowledgementRow } from '@tender-os/schemas'
import { isAddendumMaterial } from '../lib/addenda/reconciliation.js'

/**
 * Read-only repository over `tender_addenda` (Phase 2 §9). An addendum
 * row here only ever asserts a change the source documents actually
 * confirmed — the `*_changed` flags are read verbatim, never inferred
 * by this layer.
 */
/**
 * Phase 20 §4A — next sequential addendum number for a tender. Reads
 * the current max rather than maintaining a separate counter, exactly
 * like every other "next sequence" computation in this codebase
 * (e.g. bid strategy version numbers) — correctness comes from the DB
 * unique constraint `tender_addenda_tender_number_unique`, not from
 * this read being perfectly race-free.
 */
export async function getNextAddendumNumber(supabase: SupabaseClient, tenderId: string): Promise<number> {
  const { data, error } = await supabase
    .from('tender_addenda')
    .select('addendum_number')
    .eq('tender_id', tenderId)
    .order('addendum_number', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return ((data?.addendum_number as number | undefined) ?? 0) + 1
}

/**
 * Phase 20 §4A/§5 — creates a DIFF_ENGINE-detected addendum: the
 * continuous surveillance engine found a material structural change
 * on a re-scan with no distinct new source document to point at
 * (unlike the original Phase 2 §9 DOCUMENT path, still written
 * directly wherever a document is confirmed as an addendum).
 * `document_id` is left null; the DB constraint
 * `tender_addenda_document_required_for_document_path` only requires
 * it when `detected_via = 'DOCUMENT'`.
 */
export async function createDiffEngineAddendum(
  supabase: SupabaseClient,
  input: {
    tenderId: string
    addendumNumber: number
    contentHash: string
    summary: string
    deadlineChanged: boolean
    briefingChanged: boolean
    requirementChanged: boolean
    evaluationChanged: boolean
    pricingChanged: boolean
    otherChanges: string | null
    impactAssessment: Record<string, unknown>
  },
): Promise<TenderAddendumRow> {
  const { data, error } = await supabase
    .from('tender_addenda')
    .insert({
      tender_id: input.tenderId,
      document_id: null,
      addendum_number: input.addendumNumber,
      published_at: new Date().toISOString(),
      summary: input.summary,
      deadline_changed: input.deadlineChanged,
      briefing_changed: input.briefingChanged,
      requirement_changed: input.requirementChanged,
      evaluation_changed: input.evaluationChanged,
      pricing_changed: input.pricingChanged,
      other_changes: input.otherChanges,
      content_hash: input.contentHash,
      impact_assessment: input.impactAssessment,
      detected_via: 'DIFF_ENGINE',
    })
    .select('*')
    .single()
  if (error) throw error
  return tenderAddendumSchema.parse(data)
}

export async function listTenderAddenda(
  supabase: SupabaseClient,
  tenderId: string,
): Promise<TenderAddendumRow[]> {
  const { data, error } = await supabase
    .from('tender_addenda')
    .select('*')
    .eq('tender_id', tenderId)
    .order('addendum_number', { ascending: true })

  if (error) throw error
  return (data ?? []).map((row) => tenderAddendumSchema.parse(row))
}

/**
 * Phase 19 §12 — one addendum row joined with the acknowledgement
 * state (if any) for one specific bid project. `isMaterial` is
 * derived, never stored redundantly (Phase 2 §9's confirmed `*_changed`
 * flags remain the single source of truth).
 */
export interface AddendumWithAcknowledgement extends TenderAddendumRow {
  isMaterial: boolean
  acknowledgement: AddendumAcknowledgementRow | null
}

export async function listAddendaWithAcknowledgements(
  supabase: SupabaseClient,
  tenderId: string,
  bidProjectId: string,
): Promise<AddendumWithAcknowledgement[]> {
  const [addenda, { data: acks, error: acksError }] = await Promise.all([
    listTenderAddenda(supabase, tenderId),
    supabase.from('bid_addendum_acknowledgements').select('*').eq('bid_project_id', bidProjectId),
  ])
  if (acksError) throw acksError
  const ackByAddendumId = new Map((acks ?? []).map((a) => [a.addendum_id as string, addendumAcknowledgementSchema.parse(a)]))
  return addenda.map((a) => ({
    ...a,
    isMaterial: isAddendumMaterial({
      id: a.id,
      addendumNumber: a.addendum_number,
      deadlineChanged: a.deadline_changed,
      briefingChanged: a.briefing_changed,
      requirementChanged: a.requirement_changed,
      evaluationChanged: a.evaluation_changed,
      pricingChanged: a.pricing_changed,
    }),
    acknowledgement: ackByAddendumId.get(a.id) ?? null,
  }))
}

/**
 * Records a human, agency-scoped acknowledgement of one addendum for
 * one bid project (Phase 19 §12). Never called from a browser-scoped
 * client — always via the service-role client from
 * routes/addenda.ts, exactly like every other write in this system.
 * Idempotent by construction: `bid_addendum_acknowledgements_unique`
 * prevents a second row for the same (bid_project_id, addendum_id); a
 * repeat call simply returns the existing row (spec §14 — a retry must
 * never create a duplicate fact).
 */
export async function acknowledgeAddendum(
  supabase: SupabaseClient,
  input: { agencyId: string; bidProjectId: string; addendumId: string; acknowledgedBy: string; reconciled: boolean; note: string | null },
): Promise<AddendumAcknowledgementRow> {
  const { data: existing } = await supabase
    .from('bid_addendum_acknowledgements')
    .select('*')
    .eq('bid_project_id', input.bidProjectId)
    .eq('addendum_id', input.addendumId)
    .maybeSingle()
  if (existing) return addendumAcknowledgementSchema.parse(existing)

  const { data, error } = await supabase
    .from('bid_addendum_acknowledgements')
    .insert({
      agency_id: input.agencyId,
      bid_project_id: input.bidProjectId,
      addendum_id: input.addendumId,
      acknowledged_by: input.acknowledgedBy,
      reconciled: input.reconciled,
      note: input.note,
    })
    .select('*')
    .single()
  if (error) {
    // Unique-violation race (two concurrent acknowledge requests): the
    // fact is already recorded, so read it back rather than erroring —
    // never a duplicate row (spec §14).
    if ((error as { code?: string }).code === '23505') {
      const { data: raced } = await supabase
        .from('bid_addendum_acknowledgements')
        .select('*')
        .eq('bid_project_id', input.bidProjectId)
        .eq('addendum_id', input.addendumId)
        .single()
      if (raced) return addendumAcknowledgementSchema.parse(raced)
    }
    throw error
  }
  return addendumAcknowledgementSchema.parse(data)
}
