import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/apiClient.js'
import { toAsyncState } from '../lib/asyncState.js'

/**
 * Phase 12 hooks — mirrors hooks/useBidDecision.ts exactly. The
 * `/api/bids*` surface is a standalone Bid Strategy dashboard,
 * distinct from the per-tender tabs Phase 10/11 added to
 * TenderDetail.tsx.
 */
export function useBidProjects() {
  const query = useQuery({ queryKey: ['bids'], queryFn: () => apiFetch<{ rows: unknown[] }>('/api/bids') })
  return toAsyncState(query)
}

export function useBidProject(id: string | undefined) {
  const query = useQuery({ queryKey: ['bids', id], queryFn: () => apiFetch<Record<string, unknown>>(`/api/bids/${id}`), enabled: Boolean(id) })
  return toAsyncState(query)
}

export interface BidStrategyDetailResponse {
  current: { strategy: Record<string, unknown>; priorities: Array<Record<string, unknown>>; winThemes: Array<Record<string, unknown>>; differentiators: Array<Record<string, unknown>> } | null
  history: Array<Record<string, unknown>>
}

export function useBidStrategyDetail(id: string | undefined) {
  const query = useQuery({ queryKey: ['bids', id, 'strategy'], queryFn: () => apiFetch<BidStrategyDetailResponse>(`/api/bids/${id}/strategy`), enabled: Boolean(id) })
  return toAsyncState(query)
}

export function useBidEvaluation(id: string | undefined, enabled: boolean) {
  const query = useQuery({ queryKey: ['bids', id, 'evaluation'], queryFn: () => apiFetch<{ rows: unknown[] }>(`/api/bids/${id}/evaluation`), enabled: Boolean(id) && enabled })
  return toAsyncState(query)
}

export function useBidRequirements(id: string | undefined, enabled: boolean) {
  const query = useQuery({ queryKey: ['bids', id, 'requirements'], queryFn: () => apiFetch<{ rows: unknown[] }>(`/api/bids/${id}/requirements`), enabled: Boolean(id) && enabled })
  return toAsyncState(query)
}

export function useBidEvidenceNeeds(id: string | undefined, enabled: boolean) {
  const query = useQuery({ queryKey: ['bids', id, 'evidence-needs'], queryFn: () => apiFetch<{ rows: unknown[] }>(`/api/bids/${id}/evidence-needs`), enabled: Boolean(id) && enabled })
  return toAsyncState(query)
}

export function useBidTasks(id: string | undefined, enabled: boolean) {
  const query = useQuery({ queryKey: ['bids', id, 'tasks'], queryFn: () => apiFetch<{ rows: unknown[] }>(`/api/bids/${id}/tasks`), enabled: Boolean(id) && enabled })
  return toAsyncState(query)
}

export function useBidMilestones(id: string | undefined, enabled: boolean) {
  const query = useQuery({ queryKey: ['bids', id, 'milestones'], queryFn: () => apiFetch<{ rows: unknown[] }>(`/api/bids/${id}/milestones`), enabled: Boolean(id) && enabled })
  return toAsyncState(query)
}

export function useBidQuestions(id: string | undefined, enabled: boolean) {
  const query = useQuery({ queryKey: ['bids', id, 'questions'], queryFn: () => apiFetch<{ rows: unknown[] }>(`/api/bids/${id}/questions`), enabled: Boolean(id) && enabled })
  return toAsyncState(query)
}

export function useBidRisks(id: string | undefined, enabled: boolean) {
  const query = useQuery({ queryKey: ['bids', id, 'risks'], queryFn: () => apiFetch<{ rows: unknown[] }>(`/api/bids/${id}/risks`), enabled: Boolean(id) && enabled })
  return toAsyncState(query)
}

export interface BidReadinessResponse {
  status: string
  blockers: Array<{ code: string; message: string }>
  warnings: Array<{ code: string; message: string }>
  completeness: Record<string, number>
}

export function useBidReadiness(id: string | undefined, enabled: boolean) {
  const query = useQuery({ queryKey: ['bids', id, 'readiness'], queryFn: () => apiFetch<BidReadinessResponse>(`/api/bids/${id}/readiness`), enabled: Boolean(id) && enabled })
  return toAsyncState(query)
}

export function useCreateBidProject(tenderId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { authorizedFromReview?: boolean } = {}) => apiFetch(`/api/tenders/${tenderId}/bid-project`, { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bids'] })
    },
  })
}

export function useGenerateStrategy(id: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => apiFetch(`/api/bids/${id}/strategy/generate`, { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bids', id] })
    },
  })
}

export function useApproveStrategy(id: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { overrideBlockers?: boolean; overrideReason?: string } = {}) => apiFetch(`/api/bids/${id}/strategy/approve`, { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bids', id, 'strategy'] })
    },
  })
}

export function useUpdateBidProjectStatus(id: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (status: string) => apiFetch(`/api/bids/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bids', id] })
    },
  })
}

export function useCreateBidQuestion(id: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { question: string; context?: string }) => apiFetch(`/api/bids/${id}/questions`, { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bids', id, 'questions'] })
    },
  })
}

export function useCreateBidTask(id: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { title: string; taskType: string; priority?: string }) => apiFetch(`/api/bids/${id}/tasks`, { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bids', id, 'tasks'] })
    },
  })
}
