import type { SupabaseClient } from '@supabase/supabase-js'
import type { SourceScanStatus } from '@tender-os/constants'
import { tenderSourceScanSchema, type TenderSourceScanRow } from '@tender-os/schemas'
import { type ListQuery, type ListResult } from './pagination.js'

/**
 * Read-only repository over `tender_source_scans` (Phase 4 §9). This
 * table is empty in Phase 4 (no adapter runs yet) — it exists so the
 * Source Registry UI and this API have somewhere real to read from
 * once Phase 5 starts writing to it, rather than the schema and the
 * read path being built at the same time as the first real scan.
 */
export async function listTenderSourceScans(
  supabase: SupabaseClient,
  sourceId: string,
  query: ListQuery,
): Promise<ListResult<TenderSourceScanRow>> {
  const { data, error } = await supabase
    .from('tender_source_scans')
    .select('*')
    .eq('source_id', sourceId)
    .order('started_at', { ascending: false })
    .range(query.offset, query.offset + query.limit - 1)

  if (error) throw error

  return {
    rows: (data ?? []).map((row) => tenderSourceScanSchema.parse(row)),
    limit: query.limit,
    offset: query.offset,
  }
}

/**
 * Consecutive FAILED scans counted back from the most recent scan,
 * stopping at the first non-FAILED status (or the start of history).
 * This is the deterministic input `sourceHealth.ts`'s
 * `computeSourceHealth` uses — it is always derived from actual scan
 * rows, never a separately-maintained counter that could drift out of
 * sync with the scan history itself.
 */
export async function countConsecutiveFailedScans(supabase: SupabaseClient, sourceId: string): Promise<number> {
  const { data, error } = await supabase
    .from('tender_source_scans')
    .select('status')
    .eq('source_id', sourceId)
    .order('started_at', { ascending: false })
    .limit(20)

  if (error) throw error

  let count = 0
  for (const row of data ?? []) {
    if ((row as { status: string }).status === 'FAILED') {
      count += 1
    } else {
      break
    }
  }
  return count
}

/**
 * Scan lifecycle writes (Phase 5 §13): a scan row is created QUEUED,
 * transitioned to RUNNING once the adapter actually starts, then
 * closed out with a terminal status and its final counts. Every write
 * goes through the privileged service-role client — never a caller's
 * own RLS-scoped client (`tender_source_scans` has no
 * authenticated-role write policy).
 */
export async function createTenderSourceScan(
  supabase: SupabaseClient,
  input: { sourceId: string; executionId: string | null; adapterVersion: string | null },
): Promise<TenderSourceScanRow> {
  const { data, error } = await supabase
    .from('tender_source_scans')
    .insert({
      source_id: input.sourceId,
      status: 'QUEUED',
      execution_id: input.executionId,
      adapter_version: input.adapterVersion,
    })
    .select('*')
    .single()
  if (error) throw error
  return tenderSourceScanSchema.parse(data)
}

export async function updateTenderSourceScan(
  supabase: SupabaseClient,
  id: string,
  patch: {
    status?: SourceScanStatus
    completedAt?: string
    recordsDiscovered?: number
    recordsProcessed?: number
    recordsFailed?: number
    documentsDiscovered?: number
    /** Phase 19 gap-closing (spec §7) — records discovered that were already-known, not newly imported/updated. */
    recordsDuplicate?: number
    /** Phase 19 gap-closing (spec §7) — retry attempts this scan run went through before its terminal status. */
    retryCount?: number
    errorCount?: number
    errorMessage?: string | null
  },
): Promise<TenderSourceScanRow> {
  const update: Record<string, unknown> = {}
  if (patch.status !== undefined) update.status = patch.status
  if (patch.completedAt !== undefined) update.completed_at = patch.completedAt
  if (patch.recordsDiscovered !== undefined) update.records_discovered = patch.recordsDiscovered
  if (patch.recordsProcessed !== undefined) update.records_processed = patch.recordsProcessed
  if (patch.recordsFailed !== undefined) update.records_failed = patch.recordsFailed
  if (patch.documentsDiscovered !== undefined) update.documents_discovered = patch.documentsDiscovered
  if (patch.recordsDuplicate !== undefined) update.records_duplicate = patch.recordsDuplicate
  if (patch.retryCount !== undefined) update.retry_count = patch.retryCount
  if (patch.errorCount !== undefined) update.error_count = patch.errorCount
  if (patch.errorMessage !== undefined) update.error_message = patch.errorMessage

  const { data, error } = await supabase.from('tender_source_scans').update(update).eq('id', id).select('*').single()
  if (error) throw error
  return tenderSourceScanSchema.parse(data)
}
