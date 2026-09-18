import type { SupabaseClient } from '@supabase/supabase-js'
import type { Severity, SourceErrorType } from '@tender-os/constants'
import { tenderSourceErrorSchema, type TenderSourceErrorRow } from '@tender-os/schemas'
import { type ListQuery, type ListResult } from './pagination.js'

/** Read-only repository over `tender_source_errors` (Phase 4 §10). Empty in Phase 4 — see tenderSourceScans.ts's equivalent note. */
export async function listTenderSourceErrors(
  supabase: SupabaseClient,
  sourceId: string,
  query: ListQuery,
): Promise<ListResult<TenderSourceErrorRow>> {
  const { data, error } = await supabase
    .from('tender_source_errors')
    .select('*')
    .eq('source_id', sourceId)
    .order('occurred_at', { ascending: false })
    .range(query.offset, query.offset + query.limit - 1)

  if (error) throw error

  return {
    rows: (data ?? []).map((row) => tenderSourceErrorSchema.parse(row)),
    limit: query.limit,
    offset: query.offset,
  }
}

/**
 * Structured error write path (Phase 5 §14/§28): every failed record
 * or failed request gets one of these, never a silently-swallowed
 * exception. `metadata` is free-form diagnostic context only — never
 * a credential, token, or cookie (Phase 4 §10 carried into Phase 5
 * §28: "Do not log API keys, passwords, tokens, cookies...").
 */
export async function createTenderSourceError(
  supabase: SupabaseClient,
  input: {
    sourceId: string
    scanId: string | null
    errorType: SourceErrorType
    severity: Severity
    message: string
    url: string | null
    statusCode: number | null
    retryable: boolean
    metadata: Record<string, unknown> | null
  },
): Promise<TenderSourceErrorRow> {
  const { data, error } = await supabase
    .from('tender_source_errors')
    .insert({
      source_id: input.sourceId,
      scan_id: input.scanId,
      error_type: input.errorType,
      severity: input.severity,
      message: input.message,
      url: input.url,
      status_code: input.statusCode,
      retryable: input.retryable,
      metadata: input.metadata,
    })
    .select('*')
    .single()
  if (error) throw error
  return tenderSourceErrorSchema.parse(data)
}
