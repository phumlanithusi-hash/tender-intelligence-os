import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/apiClient.js'
import { toAsyncState } from '../lib/asyncState.js'

/**
 * Phase 14 hooks — mirrors hooks/useEvidenceMatching.ts /
 * hooks/useBidStrategy.ts exactly.
 */

export interface BidProposalSectionRow {
  id: string
  section_type: string
  title: string
  objective: string | null
  status: string
  origin: string
  is_mandatory: boolean
  sort_order: number
  last_generated_at: string | null
  last_edited_at: string | null
}

export interface BidProposalRow {
  proposal: { id: string; status: string; current_version: number } | null
}

export function useProposal(bidProjectId: string | undefined) {
  const query = useQuery({
    queryKey: ['bids', bidProjectId, 'proposal'],
    queryFn: () => apiFetch<{ proposal: Record<string, unknown>; currentVersion: Record<string, unknown> | null; sections: BidProposalSectionRow[] }>(`/api/bids/${bidProjectId}/proposal`),
    enabled: Boolean(bidProjectId),
    retry: false,
  })
  return toAsyncState(query)
}

export function useCreateProposal(bidProjectId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => apiFetch(`/api/bids/${bidProjectId}/proposal`, { method: 'POST' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['bids', bidProjectId, 'proposal'] }),
  })
}

export function useProposalSection(bidProjectId: string | undefined, sectionId: string | undefined) {
  const query = useQuery({
    queryKey: ['bids', bidProjectId, 'proposal', 'sections', sectionId],
    queryFn: () => apiFetch<{ section: Record<string, unknown>; blocks: Array<Record<string, unknown>>; claims: Array<Record<string, unknown>>; requirementLinks: Array<Record<string, unknown>>; evaluationLinks: Array<Record<string, unknown>>; generations: Array<Record<string, unknown>> }>(`/api/bids/${bidProjectId}/proposal/sections/${sectionId}`),
    enabled: Boolean(bidProjectId) && Boolean(sectionId),
  })
  return toAsyncState(query)
}

export function useGenerateProposalSection(bidProjectId: string | undefined, sectionId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (userInstructions?: string) => apiFetch(`/api/bids/${bidProjectId}/proposal/sections/${sectionId}/generate`, { method: 'POST', body: JSON.stringify({ userInstructions: userInstructions ?? null }) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bids', bidProjectId, 'proposal'] })
      void queryClient.invalidateQueries({ queryKey: ['bids', bidProjectId, 'proposal', 'sections', sectionId] })
    },
  })
}

export function useReviewProposalSection(bidProjectId: string | undefined, sectionId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ action, reason }: { action: 'review' | 'approve' | 'reject'; reason?: string }) =>
      apiFetch(`/api/bids/${bidProjectId}/proposal/sections/${sectionId}/${action}`, { method: 'POST', body: JSON.stringify(reason ? { reason } : {}) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bids', bidProjectId, 'proposal'] })
      void queryClient.invalidateQueries({ queryKey: ['bids', bidProjectId, 'proposal', 'sections', sectionId] })
    },
  })
}

export function useProposalCompliance(bidProjectId: string | undefined) {
  const query = useQuery({
    queryKey: ['bids', bidProjectId, 'proposal', 'compliance'],
    queryFn: () => apiFetch<{ rows: Array<Record<string, unknown>> }>(`/api/bids/${bidProjectId}/proposal/compliance`),
    enabled: Boolean(bidProjectId),
  })
  return toAsyncState(query)
}

export function useRunProposalCompliance(bidProjectId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => apiFetch(`/api/bids/${bidProjectId}/proposal/compliance/run`, { method: 'POST' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['bids', bidProjectId, 'proposal', 'compliance'] }),
  })
}
