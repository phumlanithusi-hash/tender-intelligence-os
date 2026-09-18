import type { SupabaseClient } from '@supabase/supabase-js'
import { tenderRequirementSchema, type TenderRequirementRow } from '@tender-os/schemas'

/**
 * Read-only repository over `tender_requirements` (Phase 2 §10). This
 * never writes `qualification_status` — that write path belongs to
 * the (not-yet-built) qualification engine, and the database itself
 * refuses a PASS with no linked evidence
 * (tender_requirements_pass_requires_evidence, database/migrations/
 * 20260910200110_tender_requirements.sql) regardless of what this API
 * layer does.
 */
export async function listTenderRequirements(
  supabase: SupabaseClient,
  tenderId: string,
): Promise<TenderRequirementRow[]> {
  const { data, error } = await supabase
    .from('tender_requirements')
    .select('*')
    .eq('tender_id', tenderId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return (data ?? []).map((row) => tenderRequirementSchema.parse(row))
}
