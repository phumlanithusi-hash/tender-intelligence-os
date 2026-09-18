import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/apiClient.js'
import { toAsyncState } from '../lib/asyncState.js'

/** Phase 16 hooks — mirrors hooks/useSubmissionReadiness.ts exactly. */

export interface SubmissionExecutionRow {
  id: string
  bidProjectId: string
  status: string
  submissionMethod: string
  automationStatus: string
  targetKind: string | null
  targetValue: string | null
  submissionPackId: string | null
  submissionPackVersion: number | null
  submissionPackHash: string | null
  manifestHash: string | null
  confirmedBy: string | null
  confirmedAt: string | null
  providerName: string | null
  providerReference: string | null
  failureCode: string | null
  failureMessage: string | null
  physicalStage: string
  version: number
}

export interface SubmissionAttemptRow {
  id: string
  attemptNumber: number
  status: string
  method: string
  packVersion: number
  startedAt: string
  completedAt: string | null
  providerReference: string | null
  errorCode: string | null
  errorMessage: string | null
}

export interface SubmissionConfirmationRow {
  id: string
  confirmedBy: string
  confirmedAt: string
  packVersion: number
  packHash: string
  statement: string
  invalidated: boolean
}

export interface SubmissionReceiptRow {
  id: string
  receiptType: string
  providerName: string | null
  providerReference: string | null
  verificationStatus: string
  capturedAt: string
  notes: string | null
}

export function useSubmissionExecution(bidProjectId: string | undefined) {
  const query = useQuery({
    queryKey: ['bids', bidProjectId, 'submission'],
    queryFn: () => apiFetch<{ execution: SubmissionExecutionRow | null; attempts: SubmissionAttemptRow[]; confirmations: SubmissionConfirmationRow[]; receipts: SubmissionReceiptRow[] }>(`/api/bids/${bidProjectId}/submission`),
    enabled: Boolean(bidProjectId),
    retry: false,
  })
  return toAsyncState(query)
}

export function usePrepareSubmission(bidProjectId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { manuallyConfirmedMethod?: string | null } = {}) => apiFetch(`/api/bids/${bidProjectId}/submission/prepare`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['bids', bidProjectId, 'submission'] }),
  })
}

export function useConfirmSubmission(bidProjectId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (statement: string) => apiFetch(`/api/bids/${bidProjectId}/submission/confirm`, { method: 'POST', body: JSON.stringify({ statement }) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['bids', bidProjectId, 'submission'] }),
  })
}

export function useAttemptSubmission(bidProjectId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (explicitDuplicateOverride: boolean = false) => apiFetch(`/api/bids/${bidProjectId}/submission/attempt`, { method: 'POST', body: JSON.stringify({ explicitDuplicateOverride }) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['bids', bidProjectId, 'submission'] }),
  })
}

export function useManualCompleteSubmission(bidProjectId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (note: string | null) => apiFetch(`/api/bids/${bidProjectId}/submission/manual-complete`, { method: 'POST', body: JSON.stringify({ note }) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['bids', bidProjectId, 'submission'] }),
  })
}

export function useCaptureSubmissionReceipt(bidProjectId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { receiptType: string; providerName?: string | null; providerReference?: string | null; notes?: string | null; providerIssued?: boolean }) => apiFetch(`/api/bids/${bidProjectId}/submission/receipts`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['bids', bidProjectId, 'submission'] }),
  })
}

export function useCancelSubmission(bidProjectId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (reason: string) => apiFetch(`/api/bids/${bidProjectId}/submission/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['bids', bidProjectId, 'submission'] }),
  })
}
