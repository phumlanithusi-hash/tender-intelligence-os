import type { BidRecommendation, BidRuleStatus, BidRuleSeverity, BidDecisionPrecedenceStep, BidEffortLevel, BidUnknownFactor, BidUnknownSeverity, BidDecisionRunStatus } from '@tender-os/constants'
import type { ScoringInput, OpportunityScoreResult, ScoringEvidenceRef } from '../scoring/types.js'

/**
 * Phase 11 §29 — the pure-function contract, mirroring
 * lib/scoring/types.ts and lib/qualification/types.ts exactly. No
 * database operations inside the pure rule engine; only
 * supabaseBidDecisionStore.ts touches Supabase.
 */

/** A single configurable rule threshold (Phase 11 §10/§13/§28). `active: false` means "configured but switched off" — distinct from the field being entirely absent (not part of this policy at all), which reads as `null`. */
export interface BidRuleThreshold<T> {
  active: boolean
  severity: BidRuleSeverity
  value: T
}

/**
 * Agency bid policy (Phase 11 §10-§14), the pure-data projection of
 * bid_policy_versions. Every threshold is optional/nullable — an
 * agency that has not configured a rule never has that rule invented
 * for it (Phase 11 §60 "no arbitrary business assumptions").
 */
export interface BidPolicyConfiguration {
  id: string // bid_policy_versions.id
  policyId: string
  version: number
  precedence: BidDecisionPrecedenceStep[]
  /** Per-hard-gate-rule-id override letting a gate resolve to REVIEW instead of NO_BID (Phase 11 §5). Rule ids not present here keep the default HARD_BLOCK behaviour. */
  hardGateOverrides: Record<string, 'REVIEW'>
  minimumOpportunityScore: BidRuleThreshold<number> | null
  minimumDataCompleteness: BidRuleThreshold<number> | null // 0-1
  minimumRequirementCoverage: BidRuleThreshold<number> | null // 0-100
  minimumEvidenceStrength: BidRuleThreshold<number> | null // 0-100
  minimumEvaluationFit: BidRuleThreshold<number> | null // 0-100
  minimumStrategicFit: BidRuleThreshold<number> | null // 0-100
  minimumContractValue: BidRuleThreshold<number> | null
  preferredContractValue: number | null
  minimumPreparationDays: BidRuleThreshold<number> | null
  maximumPreparationDays: BidRuleThreshold<number> | null
  /** Phase 11 §20 — always reported UNKNOWN/WARNING in this phase; no real cost/pricing data source exists yet. Kept as a schema/rule seam only. */
  minimumExpectedMargin: BidRuleThreshold<number> | null
  maximumBidEffort: BidRuleThreshold<BidEffortLevel> | null
  preferredServices: string[]
  preferredSectors: string[]
  preferredOrganisationTypes: string[]
  preferredProvinces: string[]
  excludedOrganisationTypes: BidRuleThreshold<string[]> | null
  excludedSectors: BidRuleThreshold<string[]> | null
  unresolvedEvaluationConflict: BidRuleThreshold<boolean> | null
  unknownSeverity: Record<BidUnknownFactor, BidUnknownSeverity>
  scoreBands: Array<{ min: number; max: number; label: string }>
}

export interface BidRuleResult {
  ruleId: string
  precedenceStep: BidDecisionPrecedenceStep
  status: BidRuleStatus
  severity: BidRuleSeverity
  actualValue: string | number | boolean | string[] | null
  expectedValue: string | number | boolean | string[] | null
  explanation: string
}

export interface BidEffortInputs {
  mandatoryDocumentCount: number
  evaluationCriteriaCount: number
  presentationRequired: boolean | null
  briefingCompulsory: boolean | null
  mandatoryFormCount: number
}

/** Phase 11 §23 — capacity schema seam only. Always `known: false` in this phase; never fabricated. */
export interface CapacityInput {
  known: boolean
  availableTeamCapacity: number | null
  requiredEffortEstimate: number | null
  currentBidWorkload: number | null
}

export interface EvaluationConflictInput {
  unresolvedCount: number
}

/**
 * Full input to `evaluateBidDecision` (Phase 11 §9/§29). Deliberately
 * built on top of the exact Phase 8/9/10 data the scoring engine
 * already assembles (`scoring`/`scoringResult`) rather than
 * re-deriving it — Phase 11 §19 "do NOT recalculate evaluation scores".
 */
export interface BidDecisionInput {
  tenderId: string
  agencyId: string
  now: string
  scoring: ScoringInput
  scoringResult: OpportunityScoreResult
  scoringRunId: string | null
  evaluationConflict: EvaluationConflictInput
  bidEffortInputs: BidEffortInputs
  capacity: CapacityInput
}

export interface BidDecisionResult {
  decision: BidRecommendation
  primaryPrecedenceStep: BidDecisionPrecedenceStep
  ruleResults: BidRuleResult[] // every rule, every time (Phase 11 §31)
  triggeredRules: BidRuleResult[] // non-PASS rules only
  blockers: BidRuleResult[] // HARD_BLOCK/NO_BID severity, FAIL status
  warnings: BidRuleResult[] // WARNING severity, non-PASS status
  unresolvedItems: BidRuleResult[] // REVIEW severity, non-PASS status (incl. UNKNOWN)
  positiveFactors: string[]
  humanActionsRequired: string[]
  decisionExplanation: string
  bidEffort: BidEffortLevel
  bidEffortExplanation: string
  policyVersion: number
  policyId: string
}

export interface BidDecisionRunRecord {
  id: string
  tenderId: string
  agencyId: string
  status: BidDecisionRunStatus
  bidPolicyVersionId: string
  scoringRunId: string | null
  systemDecision: BidRecommendation | null
  humanDecision: BidRecommendation | null
  finalDecision: BidRecommendation | null
  overrideReason: string | null
  overriddenBy: string | null
  overriddenAt: string | null
  bidEffort: BidEffortLevel
  bidEffortExplanation: string | null
  decisionExplanation: string | null
  isCurrent: boolean
  inputSnapshot: Record<string, unknown>
  createdAt: string
}

export type { ScoringEvidenceRef }
