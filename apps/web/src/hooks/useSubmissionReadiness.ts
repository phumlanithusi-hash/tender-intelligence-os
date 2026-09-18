import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/apiClient.js'
import { toAsyncState } from '../lib/asyncState.js'

/**
 * Phase 15 hooks — mirrors hooks/useProposal.ts / hooks/useBidStrategy.ts
 * exactly.
 */

export interface SubmissionReadinessItemRow {
  id: string
  category: string
  severity: 'BLOCKER' | 'WARNING' | 'INFO'
  code: string
  message: string
  sourceType: string | null
  sourceId: string | null
  resolved: boolean
}

export interface SubmissionReadinessRow {
  id: string
  bidProjectId: string
  status: string
  computedAt: string
  categorySummary: Record<string, { blockers: number; warnings: number; info: number }>
}

export function useSubmissionReadiness(bidProjectId: string | undefined) {
  const query = useQuery({
    queryKey: ['bids', bidProjectId, 'submission-readiness'],
    queryFn: () => apiFetch<{ readiness: SubmissionReadinessRow | null; items: SubmissionReadinessItemRow[] }>(`/api/bids/${bidProjectId}/submission-readiness`),
    enabled: Boolean(bidProjectId),
    retry: false,
  })
  return toAsyncState(query)
}

export function useRunSubmissionReadinessCheck(bidProjectId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => apiFetch(`/api/bids/${bidProjectId}/submission-readiness/check`, { method: 'POST' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['bids', bidProjectId, 'submission-readiness'] }),
  })
}

export function usePricing(bidProjectId: string | undefined) {
  const query = useQuery({
    queryKey: ['bids', bidProjectId, 'pricing'],
    queryFn: () => apiFetch<{ pricing: Record<string, unknown> | null }>(`/api/bids/${bidProjectId}/pricing`),
    enabled: Boolean(bidProjectId),
  })
  return toAsyncState(query)
}

export function useAddPricingItem(bidProjectId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (item: { lineNumber: number; description: string; quantity: number; unit?: string | null; unitPrice: number; lineTotal: number }) =>
      apiFetch(`/api/bids/${bidProjectId}/pricing/items`, { method: 'POST', body: JSON.stringify(item) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['bids', bidProjectId, 'pricing'] }),
  })
}

export function useSubmissionPack(bidProjectId: string | undefined) {
  const query = useQuery({
    queryKey: ['bids', bidProjectId, 'submission-pack'],
    queryFn: () => apiFetch<{ pack: Record<string, unknown> | null }>(`/api/bids/${bidProjectId}/submission-pack`),
    enabled: Boolean(bidProjectId),
  })
  return toAsyncState(query)
}

export function useBuildSubmissionPack(bidProjectId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => apiFetch(`/api/bids/${bidProjectId}/submission-pack`, { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bids', bidProjectId, 'submission-pack'] })
      void queryClient.invalidateQueries({ queryKey: ['bids', bidProjectId, 'submission-manifest'] })
    },
  })
}

export function useSubmissionManifest(bidProjectId: string | undefined) {
  const query = useQuery({
    queryKey: ['bids', bidProjectId, 'submission-manifest'],
    queryFn: () => apiFetch<{ manifest: Record<string, unknown> | null }>(`/api/bids/${bidProjectId}/submission-manifest`),
    enabled: Boolean(bidProjectId),
  })
  return toAsyncState(query)
}

export function useApproveForSubmission(bidProjectId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (approvalReason: string) => apiFetch(`/api/bids/${bidProjectId}/submission-approval`, { method: 'POST', body: JSON.stringify({ approvalReason }) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['bids', bidProjectId, 'submission-readiness'] }),
  })
}
