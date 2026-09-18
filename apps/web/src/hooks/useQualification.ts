import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { QualificationDto, QualificationRequirementDto, QualificationActionDto } from '@tender-os/schemas'
import { apiFetch } from '../lib/apiClient.js'
import { toAsyncState } from '../lib/asyncState.js'

/** Phase 8 §33/§34 — current qualification run + per-requirement results for a tender. */
export function useQualification(tenderId: string | undefined, enabled = true) {
  const query = useQuery({
    queryKey: ['tenders', tenderId, 'qualification'],
    queryFn: () => apiFetch<QualificationDto>(`/api/tenders/${tenderId}/qualification`),
    enabled: Boolean(tenderId) && enabled,
    staleTime: 5_000,
  })
  return toAsyncState(query)
}

export function useQualificationRequirements(tenderId: string | undefined, enabled: boolean) {
  const query = useQuery({
    queryKey: ['tenders', tenderId, 'qualification', 'requirements'],
    queryFn: () => apiFetch<QualificationRequirementDto[]>(`/api/tenders/${tenderId}/qualification/requirements`),
    enabled: Boolean(tenderId) && enabled,
    staleTime: 10_000,
  })
  return toAsyncState(query)
}

export function useQualificationActions(tenderId: string | undefined, enabled: boolean) {
  const query = useQuery({
    queryKey: ['tenders', tenderId, 'qualification', 'actions'],
    queryFn: () => apiFetch<QualificationActionDto[]>(`/api/tenders/${tenderId}/qualification/actions`),
    enabled: Boolean(tenderId) && enabled,
    staleTime: 5_000,
  })
  return toAsyncState(query)
}

/** Runs synchronously server-side (no OpenAI call — pure deterministic engine), so a single invalidation after success is enough; no polling needed (unlike AI classification). */
export function useEvaluateQualification(tenderId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => apiFetch<{ runId: string; overallStatus: string }>(`/api/tenders/${tenderId}/qualification/evaluate`, { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tenders', tenderId, 'qualification'] })
    },
  })
}

export function useSubmitQualificationReview(tenderId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { requirementId?: string | null; decision: string; note?: string | null }) =>
      apiFetch(`/api/tenders/${tenderId}/qualification/review`, { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tenders', tenderId, 'qualification'] })
    },
  })
}
