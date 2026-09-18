import { useQuery } from '@tanstack/react-query'
import type { AsyncState } from '@tender-os/types'
import type { HealthCheckResponse } from '@tender-os/schemas'
import { apiFetch } from '../lib/apiClient.js'

/**
 * Example resource hook demonstrating the required pattern (spec §10):
 * every hook maps its query result to the shared AsyncState<T> union
 * rather than leaving loading/error handling implicit in component
 * code. Later-phase hooks (useTenders, useBids, ...) follow this same
 * shape once their endpoints exist.
 */
export function useHealth(): AsyncState<HealthCheckResponse> {
  const query = useQuery({
    queryKey: ['health'],
    queryFn: () => apiFetch<HealthCheckResponse>('/api/health'),
  })

  if (query.isPending) return { status: 'loading' }
  if (query.isError) {
    return { status: 'error', error: query.error instanceof Error ? query.error.message : 'Unknown error' }
  }
  return { status: 'success', data: query.data }
}
