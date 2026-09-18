import type { SupabaseClient } from '@supabase/supabase-js'
import { tenderScoreSchema, type TenderScoreRow } from '@tender-os/schemas'

/**
 * Read-only repository over `tender_scores` (Phase 2 §13). Under RLS
 * this can only ever return the caller's own agency's score rows for
 * a tender (docs/DATABASE.md §5), so there is no separate agencyId
 * filter here — the database itself is the source of truth for
 * "whose score is this." Returns the most recently calculated score,
 * matching `tender_scores_tender_agency_calculated_idx`'s intended
 * "current score" lookup — never recomputed by this layer (Phase 2
 * §13: application code, not the API, is the scoring authority; this
 * repository does not even attempt the arithmetic).
 */
export async function getCurrentTenderScore(
  supabase: SupabaseClient,
  tenderId: string,
): Promise<TenderScoreRow | null> {
  const { data, error } = await supabase
    .from('tender_scores')
    .select('*')
    .eq('tender_id', tenderId)
    .order('calculated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return data ? tenderScoreSchema.parse(data) : null
}
