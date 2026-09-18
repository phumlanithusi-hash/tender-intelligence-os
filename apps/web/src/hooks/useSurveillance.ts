import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/apiClient.js'
import { toAsyncState } from '../lib/asyncState.js'

/** Phase 20 §4A hooks — continuous surveillance / polling schedule. */

export interface PollScheduleRow {
  sourceId: string
  name: string | null
  adapterKey: string | null
  due: boolean
  reason: string
  nextPollAt: string | null
}

export function usePollSchedule() {
  const query = useQuery({
    queryKey: ['surveillance', 'poll-schedule'],
    queryFn: async () => (await apiFetch<{ data: PollScheduleRow[] }>('/api/surveillance/poll-schedule')).data,
  })
  return toAsyncState(query)
}

export function useRunSurveillanceScan() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (sourceId: string) => apiFetch(`/api/surveillance/scan/${sourceId}`, { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['surveillance'] })
    },
  })
}
