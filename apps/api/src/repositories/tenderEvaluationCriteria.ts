import type { SupabaseClient } from '@supabase/supabase-js'
import { tenderEvaluationCriterionSchema, type TenderEvaluationCriterionRow } from '@tender-os/schemas'

/**
 * Read-only repository over `tender_evaluation_criteria` (Phase 2
 * §11). Deliberately returns exactly what the source documents
 * established for THIS tender — no default 80/20 (technical/price)
 * split is assumed or backfilled when a tender has no criteria rows
 * yet (Phase 2 §11: "the actual tender evaluation model always takes
 * precedence").
 */
export async function listTenderEvaluationCriteria(
  supabase: SupabaseClient,
  tenderId: string,
): Promise<TenderEvaluationCriterionRow[]> {
  const { data, error } = await supabase
    .from('tender_evaluation_criteria')
    .select('*')
    .eq('tender_id', tenderId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return (data ?? []).map((row) => tenderEvaluationCriterionSchema.parse(row))
}
