import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/apiClient.js'
import { toAsyncState } from '../lib/asyncState.js'

/** Phase 19 gap-closing (spec §15) hooks for the notification inbox. */
export interface NotificationRow {
  id: string
  user_id: string | null
  agency_id: string | null
  event_type: string
  channel: string
  payload: Record<string, unknown> | null
  entity_type: string | null
  entity_id: string | null
  related_tender_id: string | null
  bid_strategy_project_id: string | null
  dedup_key: string | null
  read_at: string | null
  dismissed_at: string | null
  sent_at: string | null
  created_at: string
}

export function useNotifications(unreadOnly = false) {
  const query = useQuery({
    queryKey: ['notifications', { unreadOnly }],
    queryFn: async () => (await apiFetch<{ data: NotificationRow[] }>(`/api/notifications?unreadOnly=${unreadOnly}`)).data,
    refetchInterval: 60_000,
  })
  return toAsyncState(query)
}

export function useUnreadNotificationCount() {
  const query = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: async () => (await apiFetch<{ data: { count: number } }>('/api/notifications/unread-count')).data.count,
    refetchInterval: 60_000,
  })
  return toAsyncState(query)
}

export function useMarkNotificationRead() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => (await apiFetch<{ data: NotificationRow }>(`/api/notifications/${id}/read`, { method: 'POST' })).data,
    onSuccess: () => void client.invalidateQueries({ queryKey: ['notifications'] }),
  })
}

export function useDismissNotification() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => (await apiFetch<{ data: NotificationRow }>(`/api/notifications/${id}/dismiss`, { method: 'POST' })).data,
    onSuccess: () => void client.invalidateQueries({ queryKey: ['notifications'] }),
  })
}

export function useRunNotificationCheck() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async () => (await apiFetch<{ data: { created: number } }>('/api/notifications/check', { method: 'POST' })).data,
    onSuccess: () => void client.invalidateQueries({ queryKey: ['notifications'] }),
  })
}
