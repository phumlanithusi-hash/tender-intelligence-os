import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ExtractedRequirementDto, EvaluationDto, ExtractionRunDto, RequirementConflictDto } from '@tender-os/schemas'
import { apiFetch } from '../lib/apiClient.js'
import { toAsyncState } from '../lib/asyncState.js'

/** Phase 9 §37/§39 — extracted requirements + requirement conflicts for a tender. */
export function useRequirements(tenderId: string | undefined, enabled = true) {
  const query = useQuery({
    queryKey: ['tenders', tenderId, 'requirements'],
    queryFn: () => apiFetch<{ requirements: ExtractedRequirementDto[]; conflicts: RequirementConflictDto[] }>(`/api/tenders/${tenderId}/requirements`),
    enabled: Boolean(tenderId) && enabled,
    staleTime: 5_000,
  })
  return toAsyncState(query)
}

/** Evaluation framework: criteria, gates, and criterion conflicts (Phase 9 §39). */
export function useEvaluation(tenderId: string | undefined, enabled = true) {
  const query = useQuery({
    queryKey: ['tenders', tenderId, 'evaluation'],
    queryFn: () => apiFetch<EvaluationDto>(`/api/tenders/${tenderId}/evaluation`),
    enabled: Boolean(tenderId) && enabled,
    staleTime: 5_000,
  })
  return toAsyncState(query)
}

/** Extraction run history — polled while a run is in flight, same pattern as useAiRuns (Phase 7). */
export function useExtractionRuns(tenderId: string | undefined, enabled: boolean) {
  const query = useQuery({
    queryKey: ['tenders', tenderId, 'requirements', 'runs'],
    queryFn: () => apiFetch<ExtractionRunDto[]>(`/api/tenders/${tenderId}/requirements/runs`),
    enabled: Boolean(tenderId) && enabled,
    staleTime: 2_000,
    refetchInterval: (query) => {
      const runs = query.state.data as ExtractionRunDto[] | undefined
      const hasActiveRun = runs?.some((r) => r.status === 'QUEUED' || r.status === 'RUNNING')
      return hasActiveRun ? 2_000 : false
    },
  })
  return toAsyncState(query)
}

/** Triggers a (re)extraction run — fire-and-forget on the server (Phase 9 §50); progress is observed via useExtractionRuns. */
export function useTriggerRequirementExtraction(tenderId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => apiFetch<{ status: string }>(`/api/tenders/${tenderId}/requirements/extract`, { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tenders', tenderId, 'requirements'] })
      void queryClient.invalidateQueries({ queryKey: ['tenders', tenderId, 'evaluation'] })
    },
  })
}

export function useSubmitRequirementReview(tenderId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { requirementId: string; decision: string; note?: string | null }) =>
      apiFetch(`/api/tenders/${tenderId}/requirements/${input.requirementId}/review`, { method: 'POST', body: JSON.stringify({ decision: input.decision, note: input.note }) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tenders', tenderId, 'requirements'] })
    },
  })
}

export function useSubmitEvaluationCriterionReview(tenderId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { criterionId: string; decision: string; note?: string | null }) =>
      apiFetch(`/api/tenders/${tenderId}/evaluation/criteria/${input.criterionId}/review`, { method: 'POST', body: JSON.stringify({ decision: input.decision, note: input.note }) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tenders', tenderId, 'evaluation'] })
    },
  })
}
