import type { BidDecisionRunStatus, BidRecommendation, BidEffortLevel } from '@tender-os/constants'
import type { BidDecisionInput, BidPolicyConfiguration, BidRuleResult, BidDecisionRunRecord } from './types.js'

export interface BidPolicyRecord {
  versionId: string
  policy: BidPolicyConfiguration
}

/**
 * Port for everything the bid-decision orchestration layer needs
 * (mirrors lib/scoring/store.ts exactly). `assembleInput` does the
 * real Phase 8/9/10 aggregation; everything downstream
 * (`evaluateBidDecision`) is pure and untestable-against-a-database on
 * purpose.
 */
export interface BidDecisionStore {
  getCurrentPolicy(agencyId: string): Promise<BidPolicyRecord>

  /** Runs (or reuses) the Phase 10 scoring engine for this tender/agency and returns its result alongside the extra Phase 11-only inputs. */
  assembleInput(tenderId: string, agencyId: string, now: string): Promise<{ input: BidDecisionInput; snapshot: Record<string, unknown> }>
  buildSnapshot(tenderId: string, agencyId: string): Promise<Record<string, unknown>>

  findActiveRun(tenderId: string, agencyId: string): Promise<{ id: string } | null>
  findCurrentRun(tenderId: string, agencyId: string): Promise<BidDecisionRunRecord | null>
  getRun(runId: string): Promise<BidDecisionRunRecord | null>
  listRuns(tenderId: string): Promise<BidDecisionRunRecord[]>

  createRun(input: { tenderId: string; agencyId: string; bidPolicyVersionId: string; scoringRunId: string | null; triggeredBy: string | null }): Promise<{ id: string }>
  updateRun(
    runId: string,
    patch: Partial<{
      status: BidDecisionRunStatus
      systemDecision: BidRecommendation | null
      finalDecision: BidRecommendation | null
      bidEffort: BidEffortLevel
      bidEffortExplanation: string | null
      decisionExplanation: string | null
      inputSnapshot: Record<string, unknown>
      error: string | null
      startedAt: string | null
      completedAt: string | null
    }>,
  ): Promise<void>
  markPreviousRunsNotCurrent(tenderId: string, agencyId: string, exceptRunId: string): Promise<void>

  saveRuleResults(runId: string, results: BidRuleResult[]): Promise<void>

  /** Phase 11 §35-§38 — human override, stored alongside (never replacing) the system decision. */
  applyOverride(runId: string, input: { humanDecision: BidRecommendation; overrideReason: string; overriddenBy: string; overriddenAt: string; expectedVersion?: number }): Promise<BidDecisionRunRecord>

  writeAuditEvent(event: { eventType: string; agencyId: string; actorId: string | null; entityId: string; oldValue: Record<string, unknown> | null; newValue: Record<string, unknown> | null }): Promise<void>
}
