import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/apiClient.js'
import { toAsyncState } from '../lib/asyncState.js'

/** Phase 20 §4C hooks — anonymized cross-agency benchmarking. */

export interface BenchmarkRow {
  category: string | null
  region: string | null
  metric_type: 'CYCLE_DAYS' | 'PRICE_VARIANCE' | 'VOLUME'
  sample_size: number
  p25?: number | null
  p50?: number | null
  p75?: number | null
  mean?: number | null
  stddev?: number | null
  status?: 'INSUFFICIENT_BENCHMARK_DATA'
}

export function useBenchmarks(filter: { category?: string; region?: string; metricType?: string } = {}) {
  const query = useQuery({
    queryKey: ['benchmarks', filter],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (filter.category) params.set('category', filter.category)
      if (filter.region) params.set('region', filter.region)
      if (filter.metricType) params.set('metricType', filter.metricType)
      const qs = params.toString()
      return (await apiFetch<{ data: BenchmarkRow[] }>(`/api/intelligence/benchmarks${qs ? `?${qs}` : ''}`)).data
    },
  })
  return toAsyncState(query)
}

export function useRecomputeBenchmarks() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => apiFetch('/api/intelligence/benchmarks/recompute', { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['benchmarks'] })
    },
  })
}
