import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../lib/apiClient.js'
import { toAsyncState } from '../lib/asyncState.js'

/** Phase 20 §4D hooks — the unified audit trail / chain-of-custody viewer. */

export interface AuditTrailEventRow {
  id: string
  correlation_id: string
  agency_id: string | null
  stage: string
  entity_type: string
  entity_id: string | null
  actor_type: 'USER' | 'SYSTEM' | 'AGENT'
  actor_id: string | null
  agent_name: string | null
  summary: string
  detail: Record<string, unknown>
  created_at: string
}

export function useRecentAuditTrailEvents(limit = 50) {
  const query = useQuery({
    queryKey: ['audit-trail', 'recent', limit],
    queryFn: async () => (await apiFetch<{ data: AuditTrailEventRow[] }>(`/api/audit-trail?limit=${limit}`)).data,
  })
  return toAsyncState(query)
}

export function useAuditTrailByCorrelation(correlationId: string | undefined, enabled = true) {
  const query = useQuery({
    queryKey: ['audit-trail', 'correlation', correlationId],
    queryFn: async () => (await apiFetch<{ data: AuditTrailEventRow[] }>(`/api/audit-trail/${correlationId}`)).data,
    enabled: Boolean(correlationId) && enabled,
  })
  return toAsyncState(query)
}
