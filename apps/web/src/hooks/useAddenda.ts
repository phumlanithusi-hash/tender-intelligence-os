import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/apiClient.js'
import { toAsyncState } from '../lib/asyncState.js'

/** Phase 19 §12 hooks — mirrors hooks/useSubmissionReadiness.ts exactly. */

export interface AddendumWithAcknowledgementRow {
  id: string
  addendum_number: number
  published_at: string | null
  summary: string | null
  deadline_changed: boolean
  briefing_changed: boolean
  requirement_changed: boolean
  evaluation_changed: boolean
  pricing_changed: boolean
  other_changes: string | null
  detected_via: 'DOCUMENT' | 'DIFF_ENGINE'
  isMaterial: boolean
  acknowledgement: { id: string; acknowledged_by: string; acknowledged_at: string; reconciled: boolean; note: string | null } | null
}

export function useBidAddenda(bidProjectId: string | undefined, enabled = true) {
  const query = useQuery({
    queryKey: ['bids', bidProjectId, 'addenda'],
    queryFn: async () => (await apiFetch<{ data: AddendumWithAcknowledgementRow[] }>(`/api/bids/${bidProjectId}/addenda`)).data,
    enabled: Boolean(bidProjectId) && enabled,
    retry: false,
  })
  return toAsyncState(query)
}

export function useAcknowledgeAddendum(bidProjectId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { addendumId: string; reconciled: boolean; note?: string }) =>
      apiFetch(`/api/bids/${bidProjectId}/addenda/${input.addendumId}/acknowledge`, { method: 'POST', body: JSON.stringify({ reconciled: input.reconciled, note: input.note }) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bids', bidProjectId, 'addenda'] })
      void queryClient.invalidateQueries({ queryKey: ['bids', bidProjectId, 'submission-readiness'] })
    },
  })
}
