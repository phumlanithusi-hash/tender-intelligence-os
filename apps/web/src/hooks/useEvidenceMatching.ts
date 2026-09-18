import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/apiClient.js'
import { toAsyncState } from '../lib/asyncState.js'

/**
 * Phase 13 hooks — mirrors hooks/useBidStrategy.ts exactly.
 */

export interface BidEvidenceMatchRow {
  id: string
  evidence_need_id: string
  candidate_entity_type: string
  status: string
  semantic_score: number | null
  rank_factors: Record<string, unknown>
  rationale: string | null
  verification_result: { checks?: Array<{ code: string; passed: boolean; message: string }> }
  verification_passed: boolean | null
  rejection_reason: string | null
  is_current: boolean
  is_stale: boolean
}

export function useEvidenceMatches(bidProjectId: string | undefined, enabled: boolean) {
  const query = useQuery({ queryKey: ['bids', bidProjectId, 'evidence-matches'], queryFn: () => apiFetch<{ rows: BidEvidenceMatchRow[] }>(`/api/bids/${bidProjectId}/evidence-matches`), enabled: Boolean(bidProjectId) && enabled })
  return toAsyncState(query)
}

export function useGenerateEvidenceMatches(bidProjectId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (evidenceNeedId?: string) => apiFetch(`/api/bids/${bidProjectId}/evidence-matches`, { method: 'POST', body: JSON.stringify({ evidenceNeedId: evidenceNeedId ?? null }) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bids', bidProjectId, 'evidence-matches'] })
      void queryClient.invalidateQueries({ queryKey: ['bids', bidProjectId, 'evidence-gaps'] })
    },
  })
}

export function useApproveEvidenceMatch(bidProjectId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (matchId: string) => apiFetch(`/api/bids/${bidProjectId}/evidence-matches/${matchId}/approve`, { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bids', bidProjectId, 'evidence-matches'] })
      void queryClient.invalidateQueries({ queryKey: ['bids', bidProjectId, 'evidence-claims'] })
      void queryClient.invalidateQueries({ queryKey: ['bids', bidProjectId, 'evidence-gaps'] })
    },
  })
}

export function useRejectEvidenceMatch(bidProjectId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ matchId, reason }: { matchId: string; reason: string }) => apiFetch(`/api/bids/${bidProjectId}/evidence-matches/${matchId}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bids', bidProjectId, 'evidence-matches'] })
      void queryClient.invalidateQueries({ queryKey: ['bids', bidProjectId, 'evidence-gaps'] })
    },
  })
}

export function useEvidenceClaims(bidProjectId: string | undefined, enabled: boolean) {
  const query = useQuery({ queryKey: ['bids', bidProjectId, 'evidence-claims'], queryFn: () => apiFetch<{ rows: unknown[] }>(`/api/bids/${bidProjectId}/evidence-claims`), enabled: Boolean(bidProjectId) && enabled })
  return toAsyncState(query)
}

export interface EvidenceGapRow {
  evidenceNeedId: string
  recommendedStatus: string
  isGap: boolean
  reason: string
  severity: string
}

export function useEvidenceGaps(bidProjectId: string | undefined, enabled: boolean) {
  const query = useQuery({ queryKey: ['bids', bidProjectId, 'evidence-gaps'], queryFn: () => apiFetch<{ rows: EvidenceGapRow[] }>(`/api/bids/${bidProjectId}/evidence-gaps`), enabled: Boolean(bidProjectId) && enabled })
  return toAsyncState(query)
}
