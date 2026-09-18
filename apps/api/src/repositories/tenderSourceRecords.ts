import type { SupabaseClient } from '@supabase/supabase-js'
import { tenderSourceRecordSchema, type TenderSourceRecordRow } from '@tender-os/schemas'

/**
 * Write access to `tender_source_records` (Phase 2 §4, Phase 5 §6/§9).
 * The table's own `unique (source_id, external_id)` constraint (Phase
 * 4's migration comment on `tenders_core.sql`) is the ultimate
 * guarantee against duplicate rows for the same source appearance —
 * this repository's `findBySourceAndExternalId` + create-or-update
 * flow is how the ingestion pipeline (lib/ingestion/scanRunner.ts)
 * gets idempotency (Phase 5 §12) without relying on a database-level
 * `ON CONFLICT` upsert (kept explicit here so the "update" path can
 * apply source-precedence rules, not just blindly overwrite).
 *
 * Always called with the privileged service-role client — never the
 * caller's own RLS-scoped client (`tender_source_records` has no
 * authenticated-role write policy, matching every other Phase 4/5
 * shared-catalogue table).
 */
export async function findSourceRecordByExternalId(
  supabase: SupabaseClient,
  sourceId: string,
  externalId: string,
): Promise<TenderSourceRecordRow | null> {
  const { data, error } = await supabase
    .from('tender_source_records')
    .select('*')
    .eq('source_id', sourceId)
    .eq('external_id', externalId)
    .maybeSingle()
  if (error) throw error
  return data ? tenderSourceRecordSchema.parse(data) : null
}

export interface CreateSourceRecordInput {
  tenderId: string | null
  sourceId: string
  externalId: string | null
  sourceUrl: string | null
  rawTitle: string | null
  rawDescription: string | null
  rawClosingDate: string | null
  rawClosingTime: string | null
  rawOrganisation: string | null
  rawData: Record<string, unknown> | null
  contentHash: string | null
}

export async function createSourceRecord(
  supabase: SupabaseClient,
  input: CreateSourceRecordInput,
): Promise<TenderSourceRecordRow> {
  const { data, error } = await supabase
    .from('tender_source_records')
    .insert({
      tender_id: input.tenderId,
      source_id: input.sourceId,
      external_id: input.externalId,
      source_url: input.sourceUrl,
      raw_title: input.rawTitle,
      raw_description: input.rawDescription,
      raw_closing_date: input.rawClosingDate,
      raw_closing_time: input.rawClosingTime,
      raw_organisation: input.rawOrganisation,
      raw_data: input.rawData,
      content_hash: input.contentHash,
    })
    .select('*')
    .single()
  if (error) throw error
  return tenderSourceRecordSchema.parse(data)
}

export interface UpdateSourceRecordInput {
  tenderId?: string | null
  sourceUrl?: string | null
  rawTitle?: string | null
  rawDescription?: string | null
  rawClosingDate?: string | null
  rawClosingTime?: string | null
  rawOrganisation?: string | null
  rawData?: Record<string, unknown> | null
  contentHash?: string | null
  lastSeenAt: string
}

/**
 * Re-scanning the same (source, external id) pair updates the
 * existing row's raw fields, `content_hash`, and `last_seen_at`
 * (Phase 5 §6/§12) — it never inserts a second row, and it never
 * touches `discovered_at` (the first-seen timestamp is permanent
 * provenance, Phase 5 §24).
 */
export async function updateSourceRecord(
  supabase: SupabaseClient,
  id: string,
  input: UpdateSourceRecordInput,
): Promise<TenderSourceRecordRow> {
  const update: Record<string, unknown> = { last_seen_at: input.lastSeenAt }
  if (input.tenderId !== undefined) update.tender_id = input.tenderId
  if (input.sourceUrl !== undefined) update.source_url = input.sourceUrl
  if (input.rawTitle !== undefined) update.raw_title = input.rawTitle
  if (input.rawDescription !== undefined) update.raw_description = input.rawDescription
  if (input.rawClosingDate !== undefined) update.raw_closing_date = input.rawClosingDate
  if (input.rawClosingTime !== undefined) update.raw_closing_time = input.rawClosingTime
  if (input.rawOrganisation !== undefined) update.raw_organisation = input.rawOrganisation
  if (input.rawData !== undefined) update.raw_data = input.rawData
  if (input.contentHash !== undefined) update.content_hash = input.contentHash

  const { data, error } = await supabase.from('tender_source_records').update(update).eq('id', id).select('*').single()
  if (error) throw error
  return tenderSourceRecordSchema.parse(data)
}

/** Candidate rows for dedupe matching (Phase 5 §9) — narrowed server-side by organisation so the in-memory dedupe pass (`adapters/etenders/dedupe.ts`) never has to reason about the entire `tenders` table. */
export async function findTenderCandidatesByOrganisation(
  supabase: SupabaseClient,
  organisation: string,
): Promise<Array<{ id: string; tender_number: string | null; organisation: string | null; title: string; closing_date: string | null }>> {
  const { data, error } = await supabase
    .from('tenders')
    .select('id, tender_number, organisation, title, closing_date')
    .eq('organisation', organisation)
  if (error) throw error
  return (data ?? []) as Array<{
    id: string
    tender_number: string | null
    organisation: string | null
    title: string
    closing_date: string | null
  }>
}

/** Candidate rows keyed purely by tender number (used when the incoming record states a number but organisation is unknown). */
export async function findTenderCandidatesByTenderNumber(
  supabase: SupabaseClient,
  tenderNumber: string,
): Promise<Array<{ id: string; tender_number: string | null; organisation: string | null; title: string; closing_date: string | null }>> {
  const { data, error } = await supabase
    .from('tenders')
    .select('id, tender_number, organisation, title, closing_date')
    .eq('tender_number', tenderNumber)
  if (error) throw error
  return (data ?? []) as Array<{
    id: string
    tender_number: string | null
    organisation: string | null
    title: string
    closing_date: string | null
  }>
}
