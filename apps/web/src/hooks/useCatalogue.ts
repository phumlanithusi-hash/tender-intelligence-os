import { useQuery } from '@tanstack/react-query'
import type { AsyncState } from '@tender-os/types'
import type { ServiceRow, TenderSourceRow } from '@tender-os/schemas'
import { apiFetch } from '../lib/apiClient.js'
import { toAsyncState } from '../lib/asyncState.js'

/**
 * The service taxonomy and tender source registry (Phase 2) — both
 * small, mostly-static lists used to populate the filter panel
 * (Phase 3 §6). Longer staleTime than tender data itself, since these
 * change rarely.
 */
export function useServices(): AsyncState<{ rows: ServiceRow[] }> {
  const query = useQuery({
    queryKey: ['services'],
    queryFn: () => apiFetch<{ rows: ServiceRow[] }>('/api/services'),
    staleTime: 5 * 60_000,
  })
  return toAsyncState(query)
}

export function useTenderSources(): AsyncState<{ rows: TenderSourceRow[] }> {
  const query = useQuery({
    queryKey: ['tender-sources'],
    queryFn: () => apiFetch<{ rows: TenderSourceRow[] }>('/api/tender-sources?limit=100'),
    staleTime: 5 * 60_000,
  })
  return toAsyncState(query)
}
