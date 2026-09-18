import type { SupabaseClient } from '@supabase/supabase-js'
import { auditTrailEventSchema, type AuditTrailEventRow } from '@tender-os/schemas'

/**
 * Phase 20 §4D — reads for the unified audit trail viewer
 * (`/settings/audit-logs`). `correlation_id` is the one thread tying
 * a whole lineage together (a bid project id once one exists, a
 * tender id before that) — see docs/DECISIONS.md for why this is a
 * plain uuid column rather than a foreign key to any one table.
 */
export async function listAuditTrailByCorrelation(supabase: SupabaseClient, correlationId: string): Promise<AuditTrailEventRow[]> {
  const { data, error } = await supabase
    .from('audit_trail_events')
    .select('*')
    .eq('correlation_id', correlationId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []).map((row) => auditTrailEventSchema.parse(row))
}

export async function listRecentAuditTrailEvents(supabase: SupabaseClient, limit: number): Promise<AuditTrailEventRow[]> {
  const { data, error } = await supabase
    .from('audit_trail_events')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []).map((row) => auditTrailEventSchema.parse(row))
}
