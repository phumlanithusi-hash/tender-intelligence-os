/**
 * Phase 18 — Predictive Procurement Intelligence, Calibration & Decision
 * Support. Mirrors database/migrations/<phase18>_predictive_intelligence.sql
 * enums exactly. See docs/PREDICTIVE-INTELLIGENCE.md.
 *
 * Every threshold below is a documented, reviewable constant — never an
 * undocumented magic number buried in a query (spec §8).
 */

/** Deterministic dataset/model-eligibility states (spec §8). A model can
 * only ever reach PRODUCTION_ELIGIBLE by passing every earlier gate — it
 * is never set directly. */
export const MODEL_ELIGIBILITY_STATE = [
  'INSUFFICIENT_DATA',
  'INSUFFICIENT_LABELS',
  'INSUFFICIENT_VARIATION',
  'HIGH_CLASS_IMBALANCE',
  'LEAKAGE_DETECTED',
  'READY_FOR_TRAINING',
  'READY_FOR_EVALUATION',
  'PRODUCTION_ELIGIBLE',
] as const
export type ModelEligibilityState = (typeof MODEL_ELIGIBILITY_STATE)[number]

/** Model version lifecycle (spec §19/§20). Statuses only ever move
 * forward except RETIRED (terminal from PRODUCTION) and FAILED
 * (terminal from any pre-PRODUCTION state) — never reversed silently. */
export const MODEL_STATUS = [
  'EXPERIMENTAL',
  'EVALUATED',
  'CALIBRATED',
  'PRODUCTION_CANDIDATE',
  'PRODUCTION',
  'RETIRED',
  'FAILED',
] as const
export type ModelStatus = (typeof MODEL_STATUS)[number]

/** Model/evaluation "type" — deliberately restricted to the deterministic
 * baselines plus one permitted simple interpretable model (spec §7). No
 * ensemble/neural option exists in this enum by design. */
export const MODEL_TYPE = ['PREVALENCE_BASELINE', 'OPPORTUNITY_SCORE_BASELINE', 'LOGISTIC_REGRESSION'] as const
export type ModelType = (typeof MODEL_TYPE)[number]

/** Prediction abstention reasons (spec §13). */
export const ABSTENTION_REASON = [
  'INSUFFICIENT_VERIFIED_OUTCOMES',
  'INSUFFICIENT_SEGMENT_SAMPLE',
  'MISSING_CRITICAL_FEATURES',
  'OUTSIDE_SUPPORTED_RANGE',
  'DISTRIBUTION_SHIFT',
  'CALIBRATION_INSUFFICIENT',
  'LEAKAGE_DETECTED',
  'MODEL_NOT_PRODUCTION_ELIGIBLE',
] as const
export type AbstentionReason = (typeof ABSTENTION_REASON)[number]

/** Governance actions recorded against a model version (spec §20/§30/§31). */
export const MODEL_PROMOTION_ACTION = ['PROMOTE', 'REJECT', 'RETIRE'] as const
export type ModelPromotionAction = (typeof MODEL_PROMOTION_ACTION)[number]

export const CALIBRATION_METHOD = ['NONE', 'PLATT', 'ISOTONIC'] as const
export type CalibrationMethod = (typeof CALIBRATION_METHOD)[number]

export const EVALUATION_TYPE = ['BASELINE_PREVALENCE', 'BASELINE_OPPORTUNITY_SCORE', 'MODEL'] as const
export type EvaluationType = (typeof EVALUATION_TYPE)[number]

export const TRAINING_RUN_STATUS = ['SKIPPED_INSUFFICIENT_DATA', 'RUNNING', 'COMPLETED', 'FAILED'] as const
export type TrainingRunStatus = (typeof TRAINING_RUN_STATUS)[number]

/** Roles (spec §26/§28/§30 — reuse existing RBAC, never a new auth system). */
export const INTELLIGENCE_VIEW_ROLES = ['ADMIN', 'BID_MANAGER', 'RESEARCHER', 'WRITER', 'REVIEWER', 'VIEWER'] as const
export const INTELLIGENCE_MANAGE_ROLES = ['ADMIN', 'BID_MANAGER'] as const
/** Production promotion / retirement requires the highest bar — spec §30. */
export const INTELLIGENCE_APPROVE_ROLES = ['ADMIN'] as const

// ---------------------------------------------------------------------
// Statistical thresholds — every one documented with its rationale.
// Adapted from, and consistent with, Phase 17's
// MIN_MEANINGFUL_SAMPLE_SIZE = 5 (a per-segment display caveat), but
// these gate whether the WHOLE dataset can train/evaluate/calibrate a
// model, so they are deliberately more conservative.
// ---------------------------------------------------------------------

/** Minimum verified, labelled, decision-time-complete observations
 * before a dataset can even be *considered* for training (spec §3/§8).
 * Rationale: below ~30 observations, a binary classifier's coefficients
 * are dominated by sampling noise (the conventional statistical
 * rule-of-thumb minimum for a usable normal approximation on a
 * proportion, n·p·(1-p) ≥ ~5 per class at a very conservative 15-20%
 * minority prevalence still requires n ≈ 30+). */
export const MIN_DATASET_SAMPLE_SIZE = 30

/** Minimum sample size to move from READY_FOR_TRAINING to actually
 * running a training pass (spec §7/§9) — a small margin above the
 * bare dataset minimum so the train/validation/test split (temporal,
 * never random-only) still leaves a non-trivial holdout. */
export const MIN_TRAINING_SAMPLE_SIZE = 50

/** Minimum observations of EACH outcome class (WON vs everything else
 * used as the negative class per spec §4) — below this a model cannot
 * learn to distinguish the minority class at all. */
export const MIN_CLASS_SAMPLE_SIZE = 10

/** A dataset is HIGH_CLASS_IMBALANCE when the minority class makes up
 * less than this fraction of labelled observations. Rationale: below
 * 10% minority prevalence, plain accuracy/AUC become unreliable
 * without explicit imbalance handling (PR-AUC, class weighting) that
 * this phase does not implement as a "production" model — so the gate
 * refuses rather than silently training a majority-class-only model. */
export const MIN_MINORITY_CLASS_FRACTION = 0.1

/** Fraction of decision-time feature fields that must be non-null for
 * a record to count as "feature-complete" (spec §3). */
export const MIN_FEATURE_COMPLETENESS = 0.7

/** Minimum sample size before a segment (category/province/value-band/
 * etc.) is shown as a headline metric rather than caveated (spec §17) —
 * reused verbatim from Phase 17's MIN_MEANINGFUL_SAMPLE_SIZE for
 * consistency across the two learning surfaces. */
export const MIN_SEGMENT_SAMPLE_SIZE = 5

/** Minimum observations inside one calibration reliability bucket
 * before its observed frequency is shown without a small-sample
 * caveat (spec §11). */
export const MIN_CALIBRATION_BUCKET_SIZE = 5

/** Number of calibration buckets used for the reliability curve
 * (deciles) — spec §11. */
export const CALIBRATION_BUCKET_COUNT = 10

/** Maximum allowed duplicate-observation rate (by bid_project_id)
 * before a dataset is treated as INSUFFICIENT_DATA regardless of raw
 * count — protects against one bid project inflating the sample via a
 * data-entry error (spec §3 "duplicate rate"). */
export const MAX_DUPLICATE_RATE = 0.05

/** Minimum ROC-AUC improvement over the better of the two baselines
 * (prevalence, Opportunity Score) before a candidate model is even
 * eligible to be shown to a human approver as PRODUCTION_CANDIDATE
 * (spec §7 "must demonstrate meaningful value over simpler
 * baselines"). Small and conservative on purpose — this is a floor,
 * not a target. */
export const MIN_AUC_IMPROVEMENT_OVER_BASELINE = 0.03

/** Maximum acceptable mean calibration error (mean |predicted −
 * observed| across buckets meeting MIN_CALIBRATION_BUCKET_SIZE) before
 * a model is considered CALIBRATED (spec §11). */
export const MAX_CALIBRATION_ERROR = 0.15
