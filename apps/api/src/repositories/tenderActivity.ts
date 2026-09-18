import type { SupabaseClient } from '@supabase/supabase-js'
import { auditLogSchema, type AuditLogRow } from '@tender-os/schemas'

/**
 * Read-only repository over `audit_logs`, filtered to one tender
 * (Phase 3 §13 "Activity" tab). RLS restricts this to ADMIN users of
 * the entry's own agency (or agency-null, system-wide entries) — a
 * non-admin caller simply gets an empty list back, not an error, so
 * the UI must render that as "no activity visible to you" rather than
 * "no activity has happened."
 */
export async function listTenderActivity(supabase: SupabaseClient, tenderId: string): Promise<AuditLogRow[]> {
  const { data, error } = await supabase
    .from('audit_logs')
    .select('*')
    .eq('entity_type', 'tender')
    .eq('entity_id', tenderId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []).map((row) => auditLogSchema.parse(row))
}
