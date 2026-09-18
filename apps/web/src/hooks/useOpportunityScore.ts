import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { OpportunityScoreDto } from '@tender-os/schemas'
import { apiFetch } from '../lib/apiClient.js'
import { toAsyncState } from '../lib/asyncState.js'

/**
 * Phase 10 §37/§39 — the current opportunity scoring run + full
 * explainable breakdown for a tender. Deliberately a SEPARATE hook/query
 * key from the pre-existing legacy `useTenderScore`/"score" tab (Phase 3)
 * — never merge these two concepts (see docs/DECISIONS.md).
 */
export function useOpportunityScore(tenderId: string | undefined, enabled = true) {
  const query = useQuery({
    queryKey: ['tenders', tenderId, 'opportunity-score'],
    queryFn: () => apiFetch<OpportunityScoreDto>(`/api/tenders/${tenderId}/opportunity-score`),
    enabled: Boolean(tenderId) && enabled,
    staleTime: 5_000,
  })
  return toAsyncState(query)
}

/** Runs synchronously server-side (pure deterministic engine, no OpenAI call) — a single invalidation after success is enough. */
export function useComputeOpportunityScore(tenderId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => apiFetch<{ runId: string; reused: boolean; overallScore: number | null; decisionSignal: string | null }>(`/api/tenders/${tenderId}/opportunity-score`, { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tenders', tenderId, 'opportunity-score'] })
    },
  })
}
