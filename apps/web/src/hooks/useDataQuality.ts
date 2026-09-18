import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/apiClient.js'
import { toAsyncState } from '../lib/asyncState.js'

/** Phase 19 §17/§18 hooks. */

export interface DataQualityViolationRow {
  id: string
  agency_id: string | null
  rule: string
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  entity_type: string
  entity_id: string
  details: Record<string, unknown>
  detected_at: string
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'DISMISSED'
  resolution: string | null
}

export function useDataQualityViolations(filter: { status?: string; severity?: string } = {}) {
  const query = useQuery({
    queryKey: ['data-quality', 'violations', filter],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (filter.status) params.set('status', filter.status)
      if (filter.severity) params.set('severity', filter.severity)
      const qs = params.toString()
      return (await apiFetch<{ data: DataQualityViolationRow[] }>(`/api/data-quality/violations${qs ? `?${qs}` : ''}`)).data
    },
  })
  return toAsyncState(query)
}

export interface CompletenessBreakdownRow {
  domain: string
  total: number
  known: number
  unverified: number
  unknown: number
  missing: number
  conflicting: number
}

export function useDataQualityCompleteness() {
  const query = useQuery({
    queryKey: ['data-quality', 'completeness'],
    queryFn: async () => (await apiFetch<{ data: CompletenessBreakdownRow[] }>('/api/data-quality/completeness')).data,
  })
  return toAsyncState(query)
}

export function useRunDataQualityScan() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => apiFetch('/api/data-quality/scan', { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['data-quality'] })
    },
  })
}

export function useResolveDataQualityViolation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { id: string; status: 'RESOLVED' | 'DISMISSED'; resolution: string }) =>
      apiFetch(`/api/data-quality/violations/${input.id}/resolve`, { method: 'POST', body: JSON.stringify({ status: input.status, resolution: input.resolution }) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['data-quality', 'violations'] })
    },
  })
}
