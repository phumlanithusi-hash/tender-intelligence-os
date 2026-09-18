import type { SourceErrorType, SourceScanStatus, Severity } from '@tender-os/constants'
import type { TenderRow, TenderSourceRecordRow, TenderSourceScanRow } from '@tender-os/schemas'
import type { CreateTenderInput } from '../../repositories/tenders.js'

/**
 * The narrow write surface the ingestion scan runner (scanRunner.ts)
 * needs — deliberately NOT `SupabaseClient` itself. Two things depend
 * on this being its own interface rather than the concrete
 * Supabase-backed repositories:
 *
 * 1. Unit tests can inject a trivial in-memory fake without
 *    reimplementing any part of the supabase-js query builder.
 * 2. The integration tests (Phase 5 §29: real DB, real schema,
 *    idempotency + partial-failure assertions) run the exact same
 *    `runEtendersScan` against a raw-`pg` implementation of this
 *    interface talking directly to the test Postgres database — this
 *    sandbox has no PostgREST endpoint to exercise supabase-js
 *    against for a true end-to-end write path, so this seam is what
 *    makes a real-database integration test possible at all without
 *    duplicating the scan runner's logic.
 *
 * Production (apps/api/src/scripts/etendersScan.ts) uses
 * `supabaseIngestionStore.ts`, which implements this interface over
 * the real privileged Supabase client — the same repositories other
 * routes use.
 */
export interface IngestionStore {
  createScan(input: { sourceId: string; executionId: string | null; adapterVersion: string | null }): Promise<TenderSourceScanRow>
  updateScan(
    id: string,
    patch: {
      status?: SourceScanStatus
      completedAt?: string
      recordsDiscovered?: number
      recordsProcessed?: number
      recordsFailed?: number
      documentsDiscovered?: number
      /** Phase 19 gap-closing (spec §7) — records discovered that were already-known, not newly imported/updated. */
      recordsDuplicate?: number
      /** Phase 19 gap-closing (spec §7) — retry attempts this scan run went through before its terminal status. */
      retryCount?: number
      errorCount?: number
      errorMessage?: string | null
    },
  ): Promise<TenderSourceScanRow>

  createError(input: {
    sourceId: string
    scanId: string | null
    errorType: SourceErrorType
    severity: Severity
    message: string
    url: string | null
    statusCode: number | null
    retryable: boolean
    metadata: Record<string, unknown> | null
  }): Promise<void>

  findSourceRecordByExternalId(sourceId: string, externalId: string): Promise<TenderSourceRecordRow | null>
  createSourceRecord(input: {
    tenderId: string | null
    sourceId: string
    externalId: string | null
    sourceUrl: string | null
    rawTitle: string | null
    rawDescription: string | null
    rawClosingDate: string | null
    rawClosingTime: string | null
    rawOrganisation: string | null
    rawData: Record<string, unknown> | null
    contentHash: string | null
  }): Promise<TenderSourceRecordRow>
  updateSourceRecord(
    id: string,
    input: {
      tenderId?: string | null
      sourceUrl?: string | null
      rawTitle?: string | null
      rawDescription?: string | null
      rawClosingDate?: string | null
      rawClosingTime?: string | null
      rawOrganisation?: string | null
      rawData?: Record<string, unknown> | null
      contentHash?: string | null
      lastSeenAt: string
    },
  ): Promise<TenderSourceRecordRow>

  findTenderCandidates(input: { organisation: string | null; tenderNumber: string | null }): Promise<
    Array<{ id: string; tender_number: string | null; organisation: string | null; title: string; closing_date: string | null }>
  >
  getTenderById(id: string): Promise<TenderRow | null>
  createTender(input: CreateTenderInput): Promise<TenderRow>
  fillUnknownTenderFields(id: string, current: TenderRow, candidate: Partial<CreateTenderInput>): Promise<TenderRow>

  findDocumentByTenderAndUrl(tenderId: string, fileUrl: string): Promise<{ id: string } | null>
  createTenderDocument(input: {
    tenderId: string
    sourceId: string | null
    filename: string
    fileUrl: string
    mimeType: string | null
    publishedAt: string | null
  }): Promise<{ id: string }>

  /**
   * Phase 20 §4A — creates a DIFF_ENGINE-detected `tender_addenda` row
   * (no `document_id`, spec §5 schema change) when a re-scan finds a
   * material structural change with no distinct new source document.
   * Idempotent by the caller supplying the next sequential
   * `addendumNumber` itself (via `getNextAddendumNumber`) — the
   * unique `(tender_id, addendum_number)` constraint is the final
   * backstop against a duplicate.
   */
  /**
   * Phase 20 §4D — optional chain-of-custody hook (SOURCE_SCAN /
   * TENDER_IMPORT / ADDENDUM_DETECTED stages). Optional because the
   * in-memory/pg test stores have no audit_trail_events table to
   * write to and exist purely to exercise scanRunner's own
   * orchestration logic — production always uses
   * `supabaseIngestionStore`, which implements this for real.
   */
  recordAuditEvent?: (input: {
    correlationId: string
    stage: 'SOURCE_SCAN' | 'TENDER_IMPORT' | 'ADDENDUM_DETECTED'
    entityType: string
    entityId: string | null
    summary: string
  }) => Promise<void>

  getNextAddendumNumber(tenderId: string): Promise<number>
  createTenderAddendum(input: {
    tenderId: string
    addendumNumber: number
    contentHash: string
    summary: string
    deadlineChanged: boolean
    briefingChanged: boolean
    requirementChanged: boolean
    evaluationChanged: boolean
    pricingChanged: boolean
    otherChanges: string | null
    impactAssessment: Record<string, unknown>
  }): Promise<{ id: string }>
}
