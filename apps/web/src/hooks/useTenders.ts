import { useQuery } from '@tanstack/react-query'
import type { AsyncState } from '@tender-os/types'
import type {
  TenderRow,
  TenderSummary,
  TenderDocumentRow,
  TenderAddendumRow,
  TenderBriefingRow,
  TenderScoreRow,
  TenderRiskRow,
  AuditLogRow,
} from '@tender-os/schemas'
import { apiFetch } from '../lib/apiClient.js'
import { toAsyncState } from '../lib/asyncState.js'
import { buildTenderQueryParams, type TenderFilters } from '../lib/tenderFilters.js'

/**
 * A tender row as shown in the Tender Radar table — the canonical
 * `tenders` columns plus display-only fields resolved server-side via
 * embedded joins (apps/api/src/repositories/tenders.ts's
 * `TenderListRow`): the services it's classified under, the sources
 * it has appeared on, and its current opportunity score for the
 * caller's own agency (RLS-scoped; null when none exists yet).
 */
export interface TenderListRow extends TenderRow {
  serviceNames: string[]
  sourceNames: string[]
  currentScore: { scoreClass: string; totalScore: number } | null
}

export interface TenderListResponse {
  rows: TenderListRow[]
  page: number
  pageSize: number
  total: number | null
  totalPages: number | null
}

/**
 * The Tender Radar's main list query (Phase 3 §19/§21). Server-side
 * pagination/filtering/sorting only — the full tender table is never
 * fetched into the browser. `staleTime` is short but non-zero: tender
 * data changes as new ones are discovered/close, but every filter
 * change shouldn't necessarily hit the network again within the same
 * few seconds (Phase 3 §27).
 */
export function useTenders(filters: TenderFilters, pagination: { page: number; pageSize: number }) {
  const params = buildTenderQueryParams(filters, pagination)
  const query = useQuery({
    queryKey: ['tenders', params.toString()],
    queryFn: () => apiFetch<TenderListResponse>(`/api/tenders?${params.toString()}`),
    placeholderData: (previousData) => previousData,
    staleTime: 15_000,
  })
  return { ...query, state: toAsyncState(query) }
}

export function useTenderSummary(): AsyncState<TenderSummary> {
  const query = useQuery({
    queryKey: ['tenders', 'summary'],
    queryFn: () => apiFetch<TenderSummary>('/api/tenders/summary'),
    staleTime: 30_000,
  })
  return toAsyncState(query)
}

export function useTender(id: string | undefined): AsyncState<TenderRow> {
  const query = useQuery({
    queryKey: ['tenders', id],
    queryFn: () => apiFetch<TenderRow>(`/api/tenders/${id}`),
    enabled: Boolean(id),
    staleTime: 30_000,
  })
  return toAsyncState(query)
}

/**
 * Each detail-tab hook below is independently queryable and lazy —
 * only fetched once its tab is actually selected (Phase 3 §27: "lazy
 * loading of detail tabs where appropriate") — by callers passing
 * `enabled` alongside `Boolean(id)`.
 */
function useTenderSubResource<T>(id: string | undefined, resource: string, enabled: boolean): AsyncState<T> {
  const query = useQuery({
    queryKey: ['tenders', id, resource],
    queryFn: () => apiFetch<T>(`/api/tenders/${id}/${resource}`),
    enabled: Boolean(id) && enabled,
    staleTime: 30_000,
  })
  return toAsyncState(query)
}

// useTenderRequirements/useTenderEvaluation (Phase 2 baseline `{ rows }`
// shape) were superseded by hooks/useRequirementsEvaluation.ts's
// useRequirements/useEvaluation, which consume the Phase 9 role-gated,
// fully provenance-linked endpoints at these same paths.

export function useTenderDocuments(id: string | undefined, enabled = true) {
  return useTenderSubResource<{ rows: TenderDocumentRow[] }>(id, 'documents', enabled)
}

export function useTenderAddenda(id: string | undefined, enabled = true) {
  return useTenderSubResource<{ rows: TenderAddendumRow[] }>(id, 'addenda', enabled)
}

export function useTenderBriefing(id: string | undefined, enabled = true) {
  return useTenderSubResource<{ rows: TenderBriefingRow[] }>(id, 'briefing', enabled)
}

export function useTenderScore(id: string | undefined, enabled = true) {
  return useTenderSubResource<{ score: TenderScoreRow | null }>(id, 'score', enabled)
}

export function useTenderRisks(id: string | undefined, enabled = true) {
  return useTenderSubResource<{ rows: TenderRiskRow[] }>(id, 'risks', enabled)
}

export function useTenderActivity(id: string | undefined, enabled = true) {
  return useTenderSubResource<{ rows: AuditLogRow[] }>(id, 'activity', enabled)
}
