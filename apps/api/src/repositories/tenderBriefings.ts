import type { SupabaseClient } from '@supabase/supabase-js'
import { tenderBriefingSchema, type TenderBriefingRow } from '@tender-os/schemas'

/** Read-only repository over `tender_briefings` (Phase 2 §12). */
export async function listTenderBriefings(
  supabase: SupabaseClient,
  tenderId: string,
): Promise<TenderBriefingRow[]> {
  const { data, error } = await supabase
    .from('tender_briefings')
    .select('*')
    .eq('tender_id', tenderId)
    .order('date', { ascending: true })

  if (error) throw error
  return (data ?? []).map((row) => tenderBriefingSchema.parse(row))
}
