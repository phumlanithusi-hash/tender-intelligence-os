import type { OpportunityDecisionSignal, OpportunityDeadlineStatus, OpportunityScoringRunStatus } from '@tender-os/constants'
import type { ScoringInput, ScoringConfiguration, ScoredComponent, ScoredGate } from './types.js'

export interface ScoringRunRecord {
  id: string
  tenderId: string
  agencyId: string
  status: OpportunityScoringRunStatus
  scoringConfigurationVersionId: string
  overallScore: number | null
  dataCompleteness: number | null
  decisionSignal: OpportunityDecisionSignal | null
  deadlineStatus: OpportunityDeadlineStatus
  timezoneUnknown: boolean
  isCurrent: boolean
  inputSnapshot: Record<string, unknown>
  createdAt: string
}

export interface ScoringConfigurationRecord {
  versionId: string
  config: ScoringConfiguration
}

/**
 * Port for everything the scoring orchestration layer needs (Phase 10
 * §10 pattern reused from lib/qualification/store.ts). `assembleInput`
 * is the one method that does real Phase 8/9/agency-evidence
 * aggregation — everything downstream of it (`evaluateOpportunity`) is
 * pure and untestable-against-a-database on purpose.
 */
export interface ScoringStore {
  getCurrentConfiguration(name?: string): Promise<ScoringConfigurationRecord>

  /** Full input for a real scoring run, plus the snapshot of consumed-input identifiers/versions used for audit + staleness (Phase 10 §34/§46). */
  assembleInput(tenderId: string, agencyId: string, now: string): Promise<{ input: ScoringInput; snapshot: Record<string, unknown> }>

  /** Cheap snapshot-only rebuild (no full input assembly) for a staleness check at read time (Phase 10 §46). */
  buildSnapshot(tenderId: string, agencyId: string): Promise<Record<string, unknown>>

  findActiveRun(tenderId: string, agencyId: string): Promise<{ id: string } | null>
  findCurrentRun(tenderId: string, agencyId: string): Promise<ScoringRunRecord | null>
  getRun(runId: string): Promise<ScoringRunRecord | null>

  createRun(input: { tenderId: string; agencyId: string; scoringConfigurationVersionId: string; triggeredBy: string | null }): Promise<{ id: string }>
  updateRun(
    runId: string,
    patch: Partial<{
      status: OpportunityScoringRunStatus
      overallScore: number | null
      dataCompleteness: number | null
      decisionSignal: OpportunityDecisionSignal | null
      deadlineStatus: OpportunityDeadlineStatus
      timezoneUnknown: boolean
      inputSnapshot: Record<string, unknown>
      error: string | null
      startedAt: string | null
      completedAt: string | null
    }>,
  ): Promise<void>
  markPreviousRunsNotCurrent(tenderId: string, agencyId: string, exceptRunId: string): Promise<void>

  saveComponents(runId: string, components: ScoredComponent[]): Promise<void>
  saveDrivers(runId: string, drivers: Array<{ dimension: string | null; description: string; evidence: unknown[] }>): Promise<void>
  saveRisks(runId: string, risks: Array<{ dimension: string | null; description: string; evidence: unknown[] }>): Promise<void>
  saveGates(runId: string, gates: ScoredGate[]): Promise<void>
}
