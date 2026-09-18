import type { SupabaseClient } from '@supabase/supabase-js'
import { tenderSourceSchema, type TenderSourceRow } from '@tender-os/schemas'
import type { AdapterState, SourceHealth } from '@tender-os/constants'
import { type ListQuery, type ListResult } from './pagination.js'

/**
 * Read-only listing/lookup over `tender_sources` (Phase 2 §3, Phase 4
 * §3). Every row this returns came straight from the table — no
 * field is inferred, merged, or defaulted beyond what Postgres
 * already stored.
 */
export async function listTenderSources(
  supabase: SupabaseClient,
  query: ListQuery,
): Promise<ListResult<TenderSourceRow>> {
  const { data, error } = await supabase
    .from('tender_sources')
    .select('*')
    .order('name', { ascending: true })
    .range(query.offset, query.offset + query.limit - 1)

  if (error) throw error

  return {
    rows: (data ?? []).map((row) => tenderSourceSchema.parse(row)),
    limit: query.limit,
    offset: query.offset,
  }
}

export async function getTenderSourceById(
  supabase: SupabaseClient,
  id: string,
): Promise<TenderSourceRow | null> {
  const { data, error } = await supabase.from('tender_sources').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return data ? tenderSourceSchema.parse(data) : null
}

/**
 * Administrative mutations (Phase 4 §17/§18). These take a caller-
 * supplied client rather than resolving one themselves so the route
 * layer stays in control of *which* client is used — every one of
 * these writes goes through the privileged service-role client
 * (apps/api/src/lib/supabaseAdmin.ts), never the caller's own
 * RLS-scoped client, because `tender_sources` (like every shared
 * catalogue table) has no authenticated-role write policy at all
 * (database/migrations/20260910200180_rls_policies.sql) — RBAC for
 * these actions is enforced in the route handler
 * (apps/api/src/lib/requireRole.ts) before this is ever called.
 */
export async function updateTenderSourceState(
  supabase: SupabaseClient,
  id: string,
  patch: {
    active?: boolean
    adapterState?: AdapterState
    healthStatus?: SourceHealth
    pausedAt?: string | null
    lastSuccessAt?: string | null
    lastFailureAt?: string | null
    errorCount?: number
  },
): Promise<TenderSourceRow | null> {
  const update: Record<string, unknown> = {}
  if (patch.active !== undefined) update.active = patch.active
  if (patch.adapterState !== undefined) update.adapter_state = patch.adapterState
  if (patch.healthStatus !== undefined) update.health_status = patch.healthStatus
  if (patch.pausedAt !== undefined) update.paused_at = patch.pausedAt
  if (patch.lastSuccessAt !== undefined) update.last_success_at = patch.lastSuccessAt
  if (patch.lastFailureAt !== undefined) update.last_failure_at = patch.lastFailureAt
  if (patch.errorCount !== undefined) update.error_count = patch.errorCount

  const { data, error } = await supabase.from('tender_sources').update(update).eq('id', id).select('*').maybeSingle()
  if (error) throw error
  return data ? tenderSourceSchema.parse(data) : null
}
