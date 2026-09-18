import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AiClassification, AiRun } from '@tender-os/schemas'
import { apiFetch, ApiError } from '../lib/apiClient.js'
import { toAsyncState } from '../lib/asyncState.js'

/**
 * Phase 7 §30/§32 — current AI classification for a tender, or null if
 * none exists yet. `pollUntilResolved: true` (pass whenever at least
 * one run has been triggered — see useAiRuns below) refetches every
 * 2s for as long as no result exists yet, so the result appears
 * without a manual page refresh once a run completes; it stops
 * automatically the moment data is non-null.
 */
export function useAiClassification(tenderId: string | undefined, enabled = true, pollUntilResolved = false) {
  const query = useQuery({
    queryKey: ['tenders', tenderId, 'ai', 'classification'],
    queryFn: async () => {
      try {
        return await apiFetch<AiClassification>(`/api/tenders/${tenderId}/ai/classification`)
      } catch (err) {
        // A 404 here means "no classification yet", not an error state.
        if (err instanceof ApiError && err.status === 404) return null
        throw err
      }
    },
    enabled: Boolean(tenderId) && enabled,
    staleTime: 10_000,
    refetchInterval: (query) => (pollUntilResolved && !query.state.data ? 2_000 : false),
  })
  return toAsyncState(query)
}

/** Run history (Phase 7 §21/§32) — polled while a run is in flight so the UI can show Queued/Running without a manual refresh. */
export function useAiRuns(tenderId: string | undefined, enabled: boolean) {
  const query = useQuery({
    queryKey: ['tenders', tenderId, 'ai', 'runs'],
    queryFn: () => apiFetch<AiRun[]>(`/api/tenders/${tenderId}/ai/runs`),
    enabled: Boolean(tenderId) && enabled,
    staleTime: 2_000,
    refetchInterval: (query) => {
      const runs = query.state.data as AiRun[] | undefined
      const hasActiveRun = runs?.some((r) => r.status === 'QUEUED' || r.status === 'RUNNING')
      return hasActiveRun ? 2_000 : false
    },
  })
  return toAsyncState(query)
}

/** Triggers a (re)classification run — fire-and-forget on the server (Phase 7 §33); progress is observed via useAiRuns. */
export function useTriggerClassification(tenderId: string | undefined, mode: 'classify' | 'reclassify') {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => apiFetch<{ status: string }>(`/api/tenders/${tenderId}/ai/${mode}`, { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tenders', tenderId, 'ai'] })
    },
  })
}
