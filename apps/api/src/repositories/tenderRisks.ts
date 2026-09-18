import type { SupabaseClient } from '@supabase/supabase-js'
import { tenderRiskSchema, type TenderRiskRow } from '@tender-os/schemas'

/**
 * Read-only repository over `tender_risks` (Phase 2 §14). Returns
 * both tender-general risks (`agency_id is null`) and this agency's
 * own risk assessments — RLS already restricts a caller from ever
 * seeing another agency's set-agency risk rows, so no additional
 * filtering happens here.
 */
export async function listTenderRisks(supabase: SupabaseClient, tenderId: string): Promise<TenderRiskRow[]> {
  const { data, error } = await supabase
    .from('tender_risks')
    .select('*')
    .eq('tender_id', tenderId)
    .order('severity', { ascending: true })

  if (error) throw error
  return (data ?? []).map((row) => tenderRiskSchema.parse(row))
}
