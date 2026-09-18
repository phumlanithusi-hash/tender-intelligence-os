import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { WatchlistItemRow } from '@tender-os/schemas'
import { apiFetch } from '../lib/apiClient.js'

/**
 * Watchlist read/write hooks (Phase 3 §15). Backed by the Phase 3
 * `watchlist_items` table (database/migrations/
 * 20260910210000_watchlist_saved_filters.sql), not localStorage — a
 * watched tender is agency/user data that should survive a device
 * change and be visible to the same user elsewhere.
 */
export function useWatchlist() {
  return useQuery({
    queryKey: ['watchlist'],
    queryFn: () => apiFetch<{ rows: WatchlistItemRow[] }>('/api/watchlist'),
    staleTime: 30_000,
  })
}

export function useIsWatched(tenderId: string | undefined): boolean {
  const { data } = useWatchlist()
  if (!tenderId || !data) return false
  return data.rows.some((row) => row.tender_id === tenderId)
}

export function useAddToWatchlist() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (params: { tenderId: string; notes?: string }) =>
      apiFetch<WatchlistItemRow>('/api/watchlist', { method: 'POST', body: JSON.stringify(params) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['watchlist'] })
    },
  })
}

export function useRemoveFromWatchlist() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (tenderId: string) => apiFetch<void>(`/api/watchlist/${tenderId}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['watchlist'] })
    },
  })
}
