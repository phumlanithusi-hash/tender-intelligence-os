import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { BidDecisionResponseDto, BidDecisionRunDto } from '@tender-os/schemas'
import { apiFetch } from '../lib/apiClient.js'
import { toAsyncState } from '../lib/asyncState.js'

/**
 * Phase 11 §46/§39 — the current bid-decision run + full explainable
 * breakdown for a tender. A separate hook/query key from
 * `useOpportunityScore` (Phase 10, "how attractive") and from the
 * pre-existing legacy `useTenderScore`/bid_projects.decision field —
 * never merge these (see docs/DECISIONS.md).
 */
export function useBidDecision(tenderId: string | undefined, enabled = true) {
  const query = useQuery({
    queryKey: ['tenders', tenderId, 'bid-decision'],
    queryFn: () => apiFetch<BidDecisionResponseDto>(`/api/tenders/${tenderId}/bid-decision`),
    enabled: Boolean(tenderId) && enabled,
    staleTime: 5_000,
  })
  return toAsyncState(query)
}

export function useBidDecisionHistory(tenderId: string | undefined, enabled: boolean) {
  const query = useQuery({
    queryKey: ['tenders', tenderId, 'bid-decision', 'history'],
    queryFn: () => apiFetch<BidDecisionRunDto[]>(`/api/tenders/${tenderId}/bid-decision/history`),
    enabled: Boolean(tenderId) && enabled,
  })
  return toAsyncState(query)
}

/** Runs synchronously server-side (pure deterministic engine, no OpenAI call). */
export function useEvaluateBidDecision(tenderId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => apiFetch<{ runId: string; reused: boolean; decision: string | null }>(`/api/tenders/${tenderId}/bid-decision/evaluate`, { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tenders', tenderId, 'bid-decision'] })
    },
  })
}

/** Phase 11 §35-§38 — human override. Never mutates the system decision; both are stored side by side. */
export function useOverrideBidDecision(tenderId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { decision: 'BID' | 'NO_BID' | 'REVIEW'; reason: string }) => apiFetch(`/api/tenders/${tenderId}/bid-decision/override`, { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tenders', tenderId, 'bid-decision'] })
    },
  })
}
