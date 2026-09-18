import type { SupabaseClient } from '@supabase/supabase-js'
import { savedFilterSchema, type SavedFilterRow } from '@tender-os/schemas'

/**
 * Repository over `saved_filters` (Phase 3 §16). `filter` stores
 * exactly the /api/tenders query-parameter shape (routes/tenders.ts)
 * — re-applying a saved filter is replaying those parameters
 * client-side, not a server-side filter DSL.
 */
export async function listSavedFilters(supabase: SupabaseClient): Promise<SavedFilterRow[]> {
  const { data, error } = await supabase
    .from('saved_filters')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []).map((row) => savedFilterSchema.parse(row))
}

export async function createSavedFilter(
  supabase: SupabaseClient,
  params: { agencyId: string; userId: string; name: string; filter: Record<string, unknown> },
): Promise<SavedFilterRow> {
  const { data, error } = await supabase
    .from('saved_filters')
    .insert({ agency_id: params.agencyId, user_id: params.userId, name: params.name, filter: params.filter })
    .select('*')
    .single()

  if (error) throw error
  return savedFilterSchema.parse(data)
}

export async function deleteSavedFilter(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from('saved_filters').delete().eq('id', id)
  if (error) throw error
}
