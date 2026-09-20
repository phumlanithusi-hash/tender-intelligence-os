import { useState, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { OpportunityDecisionSignal } from '@tender-os/constants'
import { apiFetch } from '../lib/apiClient.js'

export interface OpportunityRow {
  tenderId: string
  title: string
  organisation: string | null
  province: string | null
  closingDate: string | null
  tenderStatus: string
  runId: string
  overallScore: number | null
  dataCompleteness: number | null
  decisionSignal: OpportunityDecisionSignal | null
  deadlineStatus: string | null
  completedAt: string | null
}

export interface OpportunitiesResponse {
  rows: OpportunityRow[]
  limit: number
  offset: number
  total?: number
}

/**
 * The Opportunities list (real intelligence already computed by the
 * Phase 10 scoring engine — see repositories/opportunities.ts). An
 * active tender that has never been scanned simply has no row here
 * yet; `useScanOpportunities` below is what produces one.
 */
export function useOpportunities(
  filters: { decisionSignal?: OpportunityDecisionSignal },
  pagination: { page: number; pageSize: number },
) {
  const params = new URLSearchParams()
  params.set('limit', String(pagination.pageSize))
  params.set('offset', String((pagination.page - 1) * pagination.pageSize))
  if (filters.decisionSignal) params.set('decisionSignal', filters.decisionSignal)

  return useQuery({
    queryKey: ['opportunities', params.toString()],
    queryFn: () => apiFetch<OpportunitiesResponse>(`/api/opportunities?${params.toString()}`),
    placeholderData: (previousData) => previousData,
    staleTime: 15_000,
  })
}

interface ScanBatchResponse {
  processed: number
  total: number
  nextOffset: number
  hasMore: boolean
  results: Array<{ tenderId: string; decisionSignal: string | null; overallScore: number | null; reused: boolean; failed: boolean; error?: string }>
}

export interface ScanProgress {
  scanned: number
  total: number
  failed: number
}

/**
 * Drives `POST /api/opportunities/scan` to completion. The endpoint
 * itself is deliberately one small page of active tenders per call
 * (see routes/opportunities.ts's doc comment on why) — this hook is
 * the loop that calls it repeatedly, advancing `offset`, until every
 * active tender has been (re-)scored, surfacing progress as it goes
 * rather than leaving the UI frozen for the whole run.
 */
export function useScanOpportunities() {
  const queryClient = useQueryClient()
  const [isScanning, setIsScanning] = useState(false)
  const [progress, setProgress] = useState<ScanProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  const scan = useCallback(async () => {
    setIsScanning(true)
    setError(null)
    let offset = 0
    let scanned = 0
    let failed = 0
    let total = 0
    try {
      for (;;) {
        const batch = await apiFetch<ScanBatchResponse>('/api/opportunities/scan', {
          method: 'POST',
          body: JSON.stringify({ offset, limit: 25 }),
        })
        total = batch.total
        scanned += batch.processed
        failed += batch.results.filter((r) => r.failed).length
        setProgress({ scanned, total, failed })
        if (!batch.hasMore) break
        offset = batch.nextOffset
      }
      await queryClient.invalidateQueries({ queryKey: ['opportunities'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The scan could not finish.')
    } finally {
      setIsScanning(false)
    }
  }, [queryClient])

  return { scan, isScanning, progress, error }
}

interface ExtractDocumentOutcome {
  documentId: string
  filename: string
  outcome: 'ALREADY_PROCESSED' | 'PROCESSED' | 'NO_ALLOWED_HOST' | 'FAILED'
  error?: string
}

interface ExtractTenderResult {
  tenderId: string
  documents: ExtractDocumentOutcome[]
  extraction: { status: string; requirementCount?: number; criterionCount?: number } | { skipped: string }
  qualification: { overallStatus: string } | { skipped: string } | { error: string }
}

interface ExtractBatchResponse {
  processed: number
  total: number
  nextOffset: number
  hasMore: boolean
  aiConfigured: boolean
  results: ExtractTenderResult[]
}

export interface ExtractProgress {
  tendersProcessed: number
  total: number
  documentsProcessed: number
  documentsFailed: number
  qualificationErrors: number
  aiConfigured: boolean
}

/**
 * Drives `POST /api/opportunities/extract` to completion — the
 * backfill step that has to run BEFORE a scan can produce anything
 * but INSUFFICIENT_DATA (2026-09-20 finding): it downloads/processes
 * each active tender's documents, runs AI requirement/evaluation
 * extraction, then deterministic qualification evaluation. Same
 * batch-and-page loop as useScanOpportunities, smaller batches (the
 * API enforces a max of 5 per call — see routes/opportunities.ts).
 */
export function useExtractIntelligence() {
  const [isExtracting, setIsExtracting] = useState(false)
  const [progress, setProgress] = useState<ExtractProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  const extract = useCallback(async () => {
    setIsExtracting(true)
    setError(null)
    let offset = 0
    let tendersProcessed = 0
    let documentsProcessed = 0
    let documentsFailed = 0
    let qualificationErrors = 0
    let total = 0
    let aiConfigured = true
    try {
      for (;;) {
        const batch = await apiFetch<ExtractBatchResponse>('/api/opportunities/extract', {
          method: 'POST',
          body: JSON.stringify({ offset, limit: 5 }),
        })
        total = batch.total
        aiConfigured = batch.aiConfigured
        tendersProcessed += batch.processed
        for (const result of batch.results) {
          documentsProcessed += result.documents.filter((d) => d.outcome === 'PROCESSED' || d.outcome === 'ALREADY_PROCESSED').length
          documentsFailed += result.documents.filter((d) => d.outcome === 'FAILED').length
          if ('error' in result.qualification) qualificationErrors += 1
        }
        setProgress({ tendersProcessed, total, documentsProcessed, documentsFailed, qualificationErrors, aiConfigured })
        if (!batch.hasMore) break
        offset = batch.nextOffset
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The extraction backfill could not finish.')
    } finally {
      setIsExtracting(false)
    }
  }, [])

  return { extract, isExtracting, progress, error }
}
