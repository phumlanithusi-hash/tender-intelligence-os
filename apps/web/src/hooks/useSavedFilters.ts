import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SavedFilterRow } from '@tender-os/schemas'
import { apiFetch } from '../lib/apiClient.js'
import type { TenderFilters } from '../lib/tenderFilters.js'

/** Saved filter read/write hooks (Phase 3 §16). */
export function useSavedFilters() {
  return useQuery({
    queryKey: ['saved-filters'],
    queryFn: () => apiFetch<{ rows: SavedFilterRow[] }>('/api/saved-filters'),
    staleTime: 30_000,
  })
}

export function useCreateSavedFilter() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (params: { name: string; filter: TenderFilters }) =>
      apiFetch<SavedFilterRow>('/api/saved-filters', { method: 'POST', body: JSON.stringify(params) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['saved-filters'] })
    },
  })
}

export function useDeleteSavedFilter() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/api/saved-filters/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['saved-filters'] })
    },
  })
}
