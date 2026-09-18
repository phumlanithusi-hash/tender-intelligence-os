import type { QualificationOverallStatus } from '@tender-os/constants'
import type { AgencyEvidenceSnapshot, QualificationRequirement, RuleResult } from './types.js'

export interface TenderQualificationContext {
  closingDate: string | null
  briefingDate: string | null
  briefingRequired: boolean | null
}

export interface QualificationRunRecord {
  id: string
  tenderId: string
  agencyId: string
  status: string
}

/**
 * Port for everything the qualification engine's orchestration layer
 * needs to read and write (Phase 8 §10 — same "interface + real
 * Supabase impl + test fake" discipline as `AiStore`/
 * `DocumentPipelineStore`). Keeping this narrow is what lets
 * `runQualification` (execution/orchestration) be tested with an
 * in-memory fake, while `evaluateRequirement` itself (evaluator.ts)
 * never touches this port at all.
 */
export interface QualificationStore {
  getRequirements(tenderId: string): Promise<QualificationRequirement[]>
  getAgencySnapshot(agencyId: string): Promise<AgencyEvidenceSnapshot>
  getTenderContext(tenderId: string): Promise<TenderQualificationContext | null>

  findActiveRun(tenderId: string, agencyId: string): Promise<QualificationRunRecord | null>
  createRun(input: { tenderId: string; agencyId: string; triggeredBy: string | null }): Promise<QualificationRunRecord>
  updateRun(
    runId: string,
    patch: {
      status?: string
      overallStatus?: QualificationOverallStatus
      mandatoryBlockerCount?: number
      actionRequiredCount?: number
      requiresReviewCount?: number
      requirementCount?: number
      error?: string | null
      startedAt?: string | null
      completedAt?: string | null
    },
  ): Promise<void>
  markPreviousRunsNotCurrent(tenderId: string, agencyId: string, exceptRunId: string): Promise<void>

  createResult(input: {
    runId: string
    requirementId: string
    tenderId: string
    agencyId: string
    result: RuleResult
  }): Promise<{ id: string }>

  createAction(input: {
    runId: string
    resultId: string
    requirementId: string
    tenderId: string
    agencyId: string
    description: string
    priority: string
    dueDate: string | null
  }): Promise<{ id: string }>

  createReview(input: {
    runId: string
    requirementId: string | null
    tenderId: string
    agencyId: string
    reviewerId: string
    decision: string
    note: string | null
  }): Promise<{ id: string }>
}
