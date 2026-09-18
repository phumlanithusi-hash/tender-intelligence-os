import type {
  AbstentionReason,
  CalibrationMethod,
  EvaluationType,
  ModelEligibilityState,
  ModelStatus,
  ModelType,
} from '@tender-os/constants'

/**
 * Phase 18 §66-style pure-function contracts for the predictive-
 * intelligence engine (readiness/leakage, baselines, temporal
 * validation, evaluation, calibration, governance, explanations).
 * Every function in lib/intelligence/*.ts other than store.ts's port
 * interface and its Supabase implementation is pure and zero-I/O,
 * mirroring lib/outcomes/*.ts's convention exactly.
 */

// ---------------------------------------------------------------------
// A single labelled, decision-time-only observation the whole engine
// operates on. Structurally cannot carry a post-outcome fact — those
// arrive only via `label` (already resolved) and never as a feature.
// ---------------------------------------------------------------------
export interface DecisionTimeObservation {
  bidProjectId: string
  decisionTimestamp: string
  /** Verified label: true = WON, false = a verified non-WON outcome
   * eligible as the negative class (LOST/DISQUALIFIED only — see
   * §4/§43 target-definition rules), null = not yet an eligible label. */
  label: boolean | null
  tenderCategory: string | null
  province: string | null
  estimatedValueBand: string | null
  opportunityScoreAtDecision: number | null
  requirementCoverageAtDecision: number | null
  evidenceStrengthAtDecision: number | null
  commercialFitAtDecision: number | null
  strategicFitAtDecision: number | null
  qualificationStatusAtDecision: string | null
  bidEffort: string | null
  /** Scoring/policy/feature-generation versions used at decision time —
   * recorded for audit, never re-derived from "current" config. */
  scoringConfigurationVersionId: string | null
  bidPolicyVersionId: string | null
}

// ---------------------------------------------------------------------
// Readiness / eligibility gate (spec §3/§8).
// ---------------------------------------------------------------------
export interface DatasetReadinessInput {
  observations: DecisionTimeObservation[]
  /** Number of duplicate bid_project_id rows found upstream (should be
   * 0 given the DB's unique constraint, but checked defensively). */
  duplicateRecordCount: number
  now: string
}

export interface DatasetReadinessResult {
  totalCandidateRecords: number
  verifiedLabelledRecords: number
  positiveCount: number
  negativeCount: number
  classBalance: number | null
  featureCompleteness: number
  temporalCoverageStart: string | null
  temporalCoverageEnd: string | null
  duplicateRate: number
  leakageCheckPassed: boolean
  leakageFindings: string[]
  eligibilityState: ModelEligibilityState
  eligibilityReasons: string[]
}

// ---------------------------------------------------------------------
// Leakage checks (spec §5/§6/§25).
// ---------------------------------------------------------------------
export interface LeakageCheckInput {
  decisionTimestamp: string
  /** Any evidence/feature timestamp claimed to be "available at
   * decision time" — must never be after decisionTimestamp. */
  featureTimestamps: string[]
  /** True if the feature snapshot came from Phase 17's stored
   * outcome_decision_time_features row rather than being reconstructed
   * from today's live tables (spec §6). */
  fromStoredSnapshot: boolean
  /** True if any outcome-only field name appears in the raw feature
   * object passed to this observation (should never happen given
   * DecisionTimeObservation's type, but checked defensively against a
   * raw untyped source row). */
  rawKeys: string[]
}
export interface LeakageCheckResult {
  passed: boolean
  findings: string[]
}

// ---------------------------------------------------------------------
// Baselines (spec §7).
// ---------------------------------------------------------------------
export interface BaselineResult {
  type: 'PREVALENCE' | 'OPPORTUNITY_SCORE'
  sampleSize: number
  auc: number | null
  predictions: number[]
  labels: boolean[]
}

// ---------------------------------------------------------------------
// Temporal validation (spec §9).
// ---------------------------------------------------------------------
export interface TemporalSplit {
  train: DecisionTimeObservation[]
  validation: DecisionTimeObservation[]
  test: DecisionTimeObservation[]
  trainPeriod: { start: string | null; end: string | null }
  validationPeriod: { start: string | null; end: string | null }
  testPeriod: { start: string | null; end: string | null }
}

export interface WalkForwardFold {
  foldIndex: number
  train: DecisionTimeObservation[]
  test: DecisionTimeObservation[]
}

// ---------------------------------------------------------------------
// Evaluation (spec §10).
// ---------------------------------------------------------------------
export interface EvaluationMetrics {
  sampleSize: number
  auc: number | null
  prAuc: number | null
  precision: number | null
  recall: number | null
  f1: number | null
  brierScore: number | null
  logLoss: number | null
  confusionMatrix: { truePositive: number; falsePositive: number; trueNegative: number; falseNegative: number } | null
}

// ---------------------------------------------------------------------
// Calibration (spec §11).
// ---------------------------------------------------------------------
export interface CalibrationBucket {
  bucketIndex: number
  predictedRangeLow: number
  predictedRangeHigh: number
  meanPredicted: number | null
  observedFrequency: number | null
  sampleSize: number
  insufficientSample: boolean
}
export interface CalibrationResult {
  method: CalibrationMethod
  buckets: CalibrationBucket[]
  meanCalibrationError: number | null
  brierScore: number | null
  sampleSize: number
}

// ---------------------------------------------------------------------
// Simple logistic-regression model (spec §7 Baseline C — the only
// non-baseline model type permitted this phase).
// ---------------------------------------------------------------------
export interface LogisticModel {
  weights: number[]
  bias: number
  featureNames: string[]
  /** Feature means/stddevs used to standardise inputs — stored so
   * prediction-time standardisation matches training exactly. */
  featureMeans: number[]
  featureStdDevs: number[]
}

// ---------------------------------------------------------------------
// Governance (spec §19/§20/§30/§31).
// ---------------------------------------------------------------------
export interface PromotionDecisionInput {
  currentStatus: ModelStatus
  targetStatus: ModelStatus
  eligibilityState: ModelEligibilityState
  latestEvaluation: EvaluationMetrics | null
  bestBaselineAuc: number | null
  latestCalibrationError: number | null
  hasModelCard: boolean
  approverRole: string | null
}
export interface PromotionDecisionResult {
  allowed: boolean
  reason: string
}

// ---------------------------------------------------------------------
// Distribution shift (spec §18).
// ---------------------------------------------------------------------
export interface DistributionShiftInput {
  trainingCategories: Set<string>
  trainingProvinces: Set<string>
  trainingValueBands: Set<string>
  candidateCategory: string | null
  candidateProvince: string | null
  candidateValueBand: string | null
  trainingSampleSize: number
}
export interface DistributionShiftResult {
  shiftDetected: boolean
  reasons: string[]
}

// ---------------------------------------------------------------------
// Abstention (spec §13).
// ---------------------------------------------------------------------
export interface AbstentionCheckInput {
  eligibilityState: ModelEligibilityState
  modelStatus: ModelStatus | null
  segmentSampleSize: number | null
  hasCriticalFeatures: boolean
  distributionShift: DistributionShiftResult | null
  calibrationError: number | null
}
export interface AbstentionCheckResult {
  shouldAbstain: boolean
  reason: AbstentionReason | null
  detail: string
}

export type { AbstentionReason, CalibrationMethod, EvaluationType, ModelEligibilityState, ModelStatus, ModelType }
