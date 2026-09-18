import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AsyncState } from '@tender-os/types'
import { apiFetch } from '../lib/apiClient.js'
import { toAsyncState } from '../lib/asyncState.js'

/**
 * Phase 17 §49/§68/§97 — read-only hooks over the server-side outcome
 * analytics. All aggregation happens on the API (apps/api/src/routes/
 * outcomes.ts), never client-side, per spec §97 — these hooks only
 * render whatever numerator/denominator/completeness the server sends.
 */
export interface OutcomeMetric {
  rate: number | null
  numerator: number
  denominator: number
  completeness: number | null
  insufficientSample: boolean
}

export interface OutcomesAnalytics {
  counts: Record<string, number>
  metrics: Record<string, OutcomeMetric>
  funnel: Array<{ stage: string; count: number; percentOfOpportunities: number | null }>
  generatedAt: string
}

export function useOutcomesAnalytics(): AsyncState<OutcomesAnalytics> {
  const query = useQuery({
    queryKey: ['analytics', 'outcomes'],
    queryFn: async () => (await apiFetch<{ data: OutcomesAnalytics }>('/api/analytics/outcomes')).data,
    staleTime: 30_000,
  })
  return toAsyncState(query)
}

export interface WinLossRow {
  groupKey: string
  winRate: OutcomeMetric
  sampleSize: number
  caveat: string | null
}

export interface WinLossTableRow {
  id: string
  tenderId: string
  tenderTitle: string | null
  organisation: string | null
  category: string | null
  province: string | null
  ourResult: string
  winnerName: string | null
  awardValue: number | null
}

export interface WinLossData {
  byCategory: WinLossRow[]
  rows: WinLossTableRow[]
  minMeaningfulSampleSize: number
}

export interface WinLossFilters {
  result?: string
  category?: string
  province?: string
}

export function useWinLossByCategory(filters: WinLossFilters = {}): AsyncState<WinLossData> {
  const params = new URLSearchParams()
  if (filters.result) params.set('result', filters.result)
  if (filters.category) params.set('category', filters.category)
  if (filters.province) params.set('province', filters.province)
  const qs = params.toString()
  const query = useQuery({
    queryKey: ['analytics', 'win-loss', filters],
    queryFn: async () => (await apiFetch<{ data: WinLossData }>(`/api/analytics/win-loss${qs ? `?${qs}` : ''}`)).data,
    staleTime: 30_000,
  })
  return toAsyncState(query)
}

export interface TenderOutcome {
  id: string
  tenderId: string
  outcomeStatus: string
  winnerName: string | null
  awardValue: number | null
  awardDate?: string | null
  decisionDate: string | null
  truthStatus: string
  provenance: string
  sourceUrl: string | null
  notes: string | null
}

export interface OutcomeConflict {
  id: string
  tenderOutcomeId: string
  fieldName: string
  existingValue: string | null
  conflictingValue: string | null
  status: string
  discoveredAt: string
}

export function useTenderOutcome(tenderId: string | undefined): AsyncState<{ data: TenderOutcome | null; conflicts: OutcomeConflict[] }> {
  const query = useQuery({
    queryKey: ['tender-outcome', tenderId],
    queryFn: () => apiFetch<{ data: TenderOutcome | null; conflicts: OutcomeConflict[] }>(`/api/tenders/${tenderId}/outcome`),
    enabled: !!tenderId,
    staleTime: 30_000,
  })
  return toAsyncState(query)
}

export interface BidOutcomeLossReason {
  id: string
  category: string
  isPrimary: boolean
  provenance: string
  notes: string | null
}

export interface BidOutcomeData {
  data: {
    id: string
    ourResult: string
    ourScore: number | null
    winningScore: number | null
    reconciliationBasis: string | null
    truthStatus: string
  }
  tenderOutcome: TenderOutcome | null
  lossReasons: BidOutcomeLossReason[]
  followUp: { requiresFollowUp: boolean; reason: string }
  /** Which signal `matchWinnerToAgency` used to resolve (or fail to resolve) the winner — REGISTRATION_NUMBER/NAME/INSUFFICIENT_DATA (apps/api/src/lib/outcomes/winnerMatch.ts). Surfaced so a reviewer can see why a result was reached, never just the result itself. */
  winnerMatchBasis?: string
}

export function useBidOutcome(bidProjectId: string | undefined, enabled = true): AsyncState<BidOutcomeData> {
  const query = useQuery({
    queryKey: ['bid-outcome', bidProjectId],
    queryFn: () => apiFetch<BidOutcomeData>(`/api/bids/${bidProjectId}/outcome`),
    enabled: !!bidProjectId && enabled,
  })
  return toAsyncState(query)
}

export function useOpenConflicts(status: 'OPEN' | 'RESOLVED' | 'DISMISSED' = 'OPEN'): AsyncState<Array<OutcomeConflict & { tender_outcomes?: { tender_id: string; winner_name: string | null } }>> {
  const query = useQuery({
    queryKey: ['outcome-conflicts', status],
    queryFn: async () => (await apiFetch<{ data: Array<OutcomeConflict & { tender_outcomes?: { tender_id: string; winner_name: string | null } }> }>(`/api/outcomes/conflicts?status=${status}`)).data,
    staleTime: 15_000,
  })
  return toAsyncState(query)
}

export function useResolveConflict() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (params: { id: string; status: 'RESOLVED' | 'DISMISSED'; notes?: string }) =>
      apiFetch(`/api/outcomes/conflicts/${params.id}/resolve`, { method: 'POST', body: JSON.stringify({ status: params.status, notes: params.notes ?? null }) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['outcome-conflicts'] })
    },
  })
}

export function useVerifyOutcome() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/api/outcomes/${id}/verify`, { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tender-outcome'] })
      void queryClient.invalidateQueries({ queryKey: ['outcome-conflicts'] })
    },
  })
}

export interface CompetitorRow {
  competitorId: string
  name: string
  dataQuality: string
  province: string | null
  hasRegistrationNumber: boolean
  bidderCount: number
  winnerCount: number
  shortlistedCount: number
  disqualifiedCount: number
  recordedBids: number
  verifiedWins: number
}

export interface CompetitorFilters {
  search?: string
  province?: string
  category?: string
  page?: number
  pageSize?: number
}

export interface CompetitorListData {
  data: CompetitorRow[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

/** Phase 17 gap-close — the competitor directory: server-side search/filter/pagination, never computed client-side (spec §97). */
export function useCompetitors(filters: CompetitorFilters = {}): AsyncState<CompetitorListData> {
  const params = new URLSearchParams()
  if (filters.search) params.set('search', filters.search)
  if (filters.province) params.set('province', filters.province)
  if (filters.category) params.set('category', filters.category)
  params.set('page', String(filters.page ?? 1))
  params.set('pageSize', String(filters.pageSize ?? 25))
  const query = useQuery({
    queryKey: ['analytics', 'competitors', filters],
    queryFn: () => apiFetch<CompetitorListData>(`/api/analytics/competitors?${params.toString()}`),
    staleTime: 15_000,
  })
  return toAsyncState(query)
}

export interface LearningReadinessData {
  totalBids: number
  verifiedSubmissions: number
  verifiedOutcomes: number
  completeFeatureSnapshots: number
  learningReadyRecords: number
  readinessNote: string
}

export function useLearningReadiness(): AsyncState<LearningReadinessData> {
  const query = useQuery({
    queryKey: ['analytics', 'learning'],
    queryFn: async () => (await apiFetch<{ data: LearningReadinessData }>('/api/analytics/learning')).data,
    staleTime: 30_000,
  })
  return toAsyncState(query)
}
