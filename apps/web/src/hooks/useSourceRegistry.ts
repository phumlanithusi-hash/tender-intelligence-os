import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AsyncState } from '@tender-os/types'
import type {
  TenderSourceRow,
  TenderSourceScanRow,
  TenderSourceErrorRow,
  TenderSourceSummary,
  SourceHealthCheckResult,
} from '@tender-os/schemas'
import { apiFetch, ApiError } from '../lib/apiClient.js'
import { toAsyncState } from '../lib/asyncState.js'

/** A source row as the Source Registry list/detail actually receives it — the stored row plus the server-computed next-scan estimate (Phase 4 §12; never stored, see the migration's comment). */
export interface TenderSourceWithSchedule extends TenderSourceRow {
  nextScheduledScanAt: string | null
}

export function useTenderSourceRegistry(): AsyncState<{ rows: TenderSourceWithSchedule[] }> {
  const query = useQuery({
    queryKey: ['tender-sources', 'registry'],
    queryFn: () => apiFetch<{ rows: TenderSourceWithSchedule[] }>('/api/tender-sources?limit=100'),
    staleTime: 15_000,
  })
  return toAsyncState(query)
}

export function useTenderSourceSummary(): AsyncState<TenderSourceSummary> {
  const query = useQuery({
    queryKey: ['tender-sources', 'summary'],
    queryFn: () => apiFetch<TenderSourceSummary>('/api/tender-sources/summary'),
    staleTime: 15_000,
  })
  return toAsyncState(query)
}

export function useTenderSource(id: string | undefined): AsyncState<TenderSourceWithSchedule> {
  const query = useQuery({
    queryKey: ['tender-sources', id],
    queryFn: () => apiFetch<TenderSourceWithSchedule>(`/api/tender-sources/${id}`),
    enabled: Boolean(id),
    staleTime: 15_000,
  })
  return toAsyncState(query)
}

export function useTenderSourceScans(id: string | undefined, enabled = true): AsyncState<{ rows: TenderSourceScanRow[] }> {
  const query = useQuery({
    queryKey: ['tender-sources', id, 'scans'],
    queryFn: () => apiFetch<{ rows: TenderSourceScanRow[] }>(`/api/tender-sources/${id}/scans?limit=20`),
    enabled: Boolean(id) && enabled,
    staleTime: 15_000,
  })
  return toAsyncState(query)
}

export function useTenderSourceErrors(id: string | undefined, enabled = true): AsyncState<{ rows: TenderSourceErrorRow[] }> {
  const query = useQuery({
    queryKey: ['tender-sources', id, 'errors'],
    queryFn: () => apiFetch<{ rows: TenderSourceErrorRow[] }>(`/api/tender-sources/${id}/errors?limit=20`),
    enabled: Boolean(id) && enabled,
    staleTime: 15_000,
  })
  return toAsyncState(query)
}

/**
 * The five Source Registry admin actions (Phase 4 §17). Every one
 * invalidates the source list/detail/summary so the UI reflects the
 * server's actual state immediately rather than an optimistic guess —
 * these are infrequent, deliberate operator actions, not something
 * that needs optimistic UI.
 */
function useSourceAction(action: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiFetch<TenderSourceRow>(`/api/tender-sources/${id}/${action}`, { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tender-sources'] })
    },
  })
}

export function useEnableSource() {
  return useSourceAction('enable')
}
export function useDisableSource() {
  return useSourceAction('disable')
}
export function usePauseSource() {
  return useSourceAction('pause')
}
export function useResumeSource() {
  return useSourceAction('resume')
}

export function useRunHealthCheck() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiFetch<SourceHealthCheckResult>(`/api/tender-sources/${id}/health-check`, { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tender-sources'] })
    },
  })
}

/** True when a source action failed specifically because the caller's role isn't allowed to perform it (Phase 4 §18) — used to show a clear message rather than a generic error. */
export function isForbiddenError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403
}
