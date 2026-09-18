/**
 * Phase 19 §16 — the operational-health view. PURE, zero-I/O: takes
 * counts the caller already queried from real tables and shapes them
 * into the dashboard payload. Never exposes secrets/credentials
 * (spec §16 binding constraint) — every field here is a plain count
 * or timestamp.
 */

export interface SourceHealthSummary {
  totalSources: number
  activeSources: number
  healthySources: number
  warningSources: number
  failedSources: number
  notConnectedSources: number
  lastScanAt: string | null
}

export interface DocumentPipelineSummary {
  queued: number
  processing: number
  completed: number
  failed: number
  requiresReview: number
}

export interface AiRunSummary {
  totalRuns: number
  failedRuns: number
  requiresReviewRuns: number
  embeddingFailures: number
}

export interface OutcomeOpsSummary {
  verified: number
  unknown: number
  conflicting: number
  requiresFollowUp: number
}

/**
 * No BullMQ/Redis queue is wired into this codebase (carried-forward
 * architectural decision, re-verified this phase — see
 * docs/PRODUCTION-OPERATIONS.md). `tender_source_scans` rows in
 * QUEUED/RUNNING status are the closest real analogue to "jobs in
 * flight" that actually exists today; this is reported honestly as
 * that, never mislabelled as a generic job queue.
 */
export interface JobSeamSummary {
  queuedScans: number
  runningScans: number
  failedScans: number
}

export interface StorageOpsSummary {
  documentsWithStoragePath: number
  documentsMissingStoragePath: number
}

export interface OpsHealthDashboard {
  sources: SourceHealthSummary
  documents: DocumentPipelineSummary
  ai: AiRunSummary
  outcomes: OutcomeOpsSummary
  jobs: JobSeamSummary
  storage: StorageOpsSummary
  generatedAt: string
}

export function buildOpsHealthDashboard(input: Omit<OpsHealthDashboard, 'generatedAt'>, nowIso: string): OpsHealthDashboard {
  return { ...input, generatedAt: nowIso }
}
