import type {
  BidResult,
  CompetitorResult,
  LossReasonCategory,
  LossReasonProvenance,
  OutcomeConflictStatus,
  OutcomeProvenance,
  OutcomeStatus,
  SubmissionStatusSnapshot,
  ValueBandKey,
} from '@tender-os/constants'
import type { DataConfidence } from '@tender-os/constants'

/**
 * Phase 17 §66 — pure-function contracts for the outcomes/analytics/
 * learning engine. Every function in lib/outcomes/*.ts (other than
 * store.ts's port interface and its Supabase implementation) is pure
 * and zero-I/O: no Date.now(), no Supabase, no network — "now" and all
 * inputs always arrive as plain arguments, mirroring
 * lib/submissions/stateMachine.ts and lib/submissionReadiness/engine.ts.
 */

// ---------------------------------------------------------------------
// Reconciliation (spec §23/§24) — the single deterministic function
// that turns (tender outcome, submission state) into OUR bid result.
// ---------------------------------------------------------------------
export interface ReconciliationInput {
  outcomeStatus: OutcomeStatus
  /** Reconciled Phase 16 submission status — never re-derived here, only consumed. */
  submissionStatus: SubmissionStatusSnapshot
  /** True only when tender_outcomes.winner_name has been matched to THIS agency (never guessed — an explicit match flag set by the caller). */
  weAreWinner: boolean | null
  /** True when a human has explicitly recorded a withdrawal for this bid. */
  explicitlyWithdrawn: boolean
  /** True when a human/official source has explicitly recorded a disqualification. */
  explicitlyDisqualified: boolean
}

export interface ReconciliationResult {
  ourResult: BidResult
  /** Human-readable, deterministic derivation trail — never a guess, always traceable (spec §24). */
  basis: string
}

// ---------------------------------------------------------------------
// Metrics (spec §27/§28) — every rate carries its own denominator and
// completeness so it is never presented divorced from its sample.
// ---------------------------------------------------------------------
export interface RateWithCompleteness {
  rate: number | null
  numerator: number
  denominator: number
  /** denominator / totalRecordsConsidered — how much of the underlying population this rate is even computed over. */
  completeness: number | null
  /** true when denominator is below MIN_MEANINGFUL_SAMPLE_SIZE — caller MUST show a caveat, never a bare headline figure. */
  insufficientSample: boolean
}

export interface OutcomeCountsInput {
  totalOpportunities: number
  totalQualified: number
  totalBidDecisions: number
  totalEligibleForSubmission: number
  submittedVerified: number
  submittedReported: number
  notSubmitted: number
  won: number
  lost: number
  disqualified: number
  withdrawn: number
  outcomeUnknown: number
  noAward: number
  cancelled: number
}

export interface CoreMetrics {
  submissionRate: RateWithCompleteness
  bidRate: RateWithCompleteness
  winRate: RateWithCompleteness
  lossRate: RateWithCompleteness
  disqualificationRate: RateWithCompleteness
  withdrawalRate: RateWithCompleteness
  noAwardRate: RateWithCompleteness
}

// ---------------------------------------------------------------------
// Win/loss funnel & table shaping (spec §50/§51).
// ---------------------------------------------------------------------
export interface OutcomeFunnelInput {
  opportunities: number
  qualified: number
  bid: number
  submitted: number
  outcomeKnown: number
  won: number
}
export interface OutcomeFunnelStage {
  stage: string
  count: number
  /** Percentage of the FIRST stage (opportunities), not the previous one — avoids compounding rounding claims. */
  percentOfOpportunities: number | null
}

// ---------------------------------------------------------------------
// Value bands / financial analytics (spec §32/§61/§62/§63).
// ---------------------------------------------------------------------
export interface ValueBandResult {
  band: ValueBandKey | 'UNKNOWN'
  label: string
}

export interface FinancialSummaryInput {
  /** Only VERIFIED or otherwise-trustworthy award values — UNKNOWN must never be coerced to 0 (spec §61). */
  awardValues: number[]
}
export interface FinancialSummary {
  total: number
  average: number | null
  median: number | null
  largest: number | null
  smallest: number | null
  countKnown: number
}

export interface PriceVarianceInput {
  ourBidValue: number | null
  winningAwardValue: number | null
}
export interface PriceVarianceResult {
  /** Never null unless one input is null. SYSTEM_CALCULATED by construction — never asserted as the reason we lost. */
  variancePercent: number | null
  label: string
}

// ---------------------------------------------------------------------
// Bid/no-bid calibration (spec §34/§36).
// ---------------------------------------------------------------------
export type CalibrationOutcome = 'WON' | 'LOST' | 'DISQUALIFIED' | 'COUNTERFACTUAL_UNKNOWN' | 'UNKNOWN'
export interface CalibrationRow {
  systemDecision: string
  outcome: CalibrationOutcome
  count: number
}

// ---------------------------------------------------------------------
// Sample-size-protected grouped metric (spec §30/§31/§33).
// ---------------------------------------------------------------------
export interface GroupedMetricRow {
  groupKey: string
  winRate: RateWithCompleteness
  sampleSize: number
}

// ---------------------------------------------------------------------
// Competitor analytics (spec §64/§65) — deliberately descriptive
// ("appears in N recorded tenders"), never a fabricated "true win rate"
// unless the sample genuinely supports a rate.
// ---------------------------------------------------------------------
export interface CompetitorActivityRecord {
  competitorId: string
  result: CompetitorResult
  tenderId: string
}
export interface CompetitorSummary {
  competitorId: string
  recordedBids: number
  verifiedWins: number
  verifiedLosses: number
  dataQualityCaveat: string
}

// ---------------------------------------------------------------------
// Learning features (spec §43/§44/§78/§79) — the leakage boundary.
// DecisionTimeFeatures may NEVER contain award_value/winner/loss_reason/
// winning_score. OutcomeFeatures hold exactly those, and only those.
// ---------------------------------------------------------------------
export interface DecisionTimeFeatures {
  bidProjectId: string
  tenderCategory: string | null
  organisationType: string | null
  province: string | null
  estimatedValueBand: ValueBandKey | 'UNKNOWN'
  qualificationStatusAtDecision: string | null
  requirementCoverageAtDecision: number | null
  evaluationFitAtDecision: number | null
  evidenceStrengthAtDecision: number | null
  commercialFitAtDecision: number | null
  strategicFitAtDecision: number | null
  opportunityScoreAtDecision: number | null
  bidEffort: string | null
  bidDecision: string | null
  submissionMethod: string | null
}

export interface OutcomeFeatures {
  bidProjectId: string
  submissionSuccess: boolean | null
  outcome: BidResult
  lossReasonPrimary: LossReasonCategory | null
  awardValue: number | null
  winningScore: number | null
}

/** The forbidden field names — used by the leakage guard test and by buildDecisionTimeFeatures's own runtime assertion. */
export const OUTCOME_ONLY_FIELDS = ['awardValue', 'winner', 'winnerName', 'lossReasonPrimary', 'winningScore', 'outcome', 'submissionSuccess'] as const

export interface LearningReadinessInput {
  totalBids: number
  verifiedSubmissions: number
  verifiedOutcomes: number
  completeFeatureSnapshots: number
}
export interface LearningReadiness {
  totalBids: number
  verifiedSubmissions: number
  verifiedOutcomes: number
  completeFeatureSnapshots: number
  learningReadyRecords: number
  /** Never a claim of "the AI has learned" — purely a count. */
  readinessNote: string
}

// ---------------------------------------------------------------------
// Conflicts (spec §17/§58).
// ---------------------------------------------------------------------
export interface ConflictCandidate {
  fieldName: string
  existingValue: string | null
  incomingValue: string | null
  existingAuthorityLevel: string | null
  incomingAuthorityLevel: string | null
}
export interface ConflictDetectionResult {
  hasConflict: boolean
  status: OutcomeConflictStatus | null
  reason: string
}

// ---------------------------------------------------------------------
// Provenance / truth helpers (spec §3/§4/§29).
// ---------------------------------------------------------------------
export interface TruthLabelInput {
  confidence: DataConfidence
  provenance: OutcomeProvenance
}
export interface OutcomeAuditContext {
  agencyId: string | null
  actorId: string | null
}

export type { OutcomeProvenance, OutcomeStatus, BidResult, LossReasonCategory, LossReasonProvenance }
