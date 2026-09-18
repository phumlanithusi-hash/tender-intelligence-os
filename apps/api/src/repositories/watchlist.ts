import type { SupabaseClient } from '@supabase/supabase-js'
import { watchlistItemSchema, type WatchlistItemRow } from '@tender-os/schemas'

/**
 * Repository over `watchlist_items` (Phase 3 §15). Every write here
 * goes through the caller's own RLS-scoped Supabase client
 * (lib/supabaseUserClient.ts), never the privileged admin client — a
 * user can only ever add/remove their own watchlist entries, which
 * the `watchlist_items_insert_own`/`_delete_own` policies enforce
 * regardless of what this repository does. `agencyId`/`userId` are
 * still passed explicitly (rather than left to a database default)
 * so a mismatched value is rejected by RLS as an explicit policy
 * violation instead of silently succeeding via some other path.
 */
export async function listWatchlist(supabase: SupabaseClient): Promise<WatchlistItemRow[]> {
  const { data, error } = await supabase
    .from('watchlist_items')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []).map((row) => watchlistItemSchema.parse(row))
}

export async function addToWatchlist(
  supabase: SupabaseClient,
  params: { agencyId: string; userId: string; tenderId: string; notes?: string | null },
): Promise<WatchlistItemRow> {
  const { data, error } = await supabase
    .from('watchlist_items')
    .insert({
      agency_id: params.agencyId,
      user_id: params.userId,
      tender_id: params.tenderId,
      notes: params.notes ?? null,
    })
    .select('*')
    .single()

  if (error) throw error
  return watchlistItemSchema.parse(data)
}

export async function removeFromWatchlist(supabase: SupabaseClient, tenderId: string): Promise<void> {
  const { error } = await supabase.from('watchlist_items').delete().eq('tender_id', tenderId)
  if (error) throw error
}
