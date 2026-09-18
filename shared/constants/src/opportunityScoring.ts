/**
 * Phase 10 — Evaluation & Opportunity Scoring Engine vocabulary, kept in
 * exact sync with database/migrations/20260911220000_opportunity_scoring.sql.
 *
 * NAMING/SEPARATION NOTE (binding constraint — see docs/DECISIONS.md):
 * this is deliberately a NEW, separately-named module. It must never be
 * confused with:
 *   - ./scoring.ts (SCORING_WEIGHTS/SCORE_CLASSIFICATION_BANDS) — an
 *     unused Phase-0 placeholder, never wired to a table or route.
 *   - Phase 9's tender evaluation criteria weights (tender_evaluation_criteria.weight)
 *     — those describe how the ISSUING ORGAN scores bidders; the weights
 *     here describe how THIS AGENCY scores the opportunity internally.
 * Never import from ./scoring.ts into the scoring engine, and never use
 * the word "bid"/"no-bid" anywhere in this module (Phase 10 §25).
 */

export const OPPORTUNITY_SCORE_DIMENSIONS = [
  'QUALIFICATION',
  'REQUIREMENT_COVERAGE',
  'EVALUATION_FIT',
  'EVIDENCE_STRENGTH',
  'COMMERCIAL_FIT',
  'STRATEGIC_FIT',
] as const
export type OpportunityScoreDimension = (typeof OPPORTUNITY_SCORE_DIMENSIONS)[number]

export const OPPORTUNITY_COMPONENT_STATUS = ['KNOWN', 'UNKNOWN', 'NOT_APPLICABLE'] as const
export type OpportunityComponentStatus = (typeof OPPORTUNITY_COMPONENT_STATUS)[number]

/** Never "BID"/"NO_BID"/"PRIORITY_BID" (Phase 10 §2/§25) — Phase 11 turns this into that decision, not this phase. */
export const OPPORTUNITY_DECISION_SIGNAL = ['HIGH_PRIORITY', 'PROMISING', 'REVIEW', 'LOW_PRIORITY', 'BLOCKED', 'INSUFFICIENT_DATA'] as const
export type OpportunityDecisionSignal = (typeof OPPORTUNITY_DECISION_SIGNAL)[number]

/** Precedence order gates are checked in (Phase 10 §24/§29) — first TRIGGERED gate found still reports ALL triggered gates, but this fixes the order they are evaluated/displayed in. */
export const OPPORTUNITY_GATE_TYPE = [
  'MANDATORY_QUALIFICATION_FAILURE',
  'MANDATORY_REQUIREMENT_FAILURE',
  'SUBMISSION_DEADLINE_PASSED',
  'COMPULSORY_BRIEFING_FAILURE',
  'CRITICAL_COMPLIANCE_FAILURE',
] as const
export type OpportunityGateType = (typeof OPPORTUNITY_GATE_TYPE)[number]

export const OPPORTUNITY_GATE_STATUS = ['TRIGGERED', 'OK', 'UNKNOWN'] as const
export type OpportunityGateStatus = (typeof OPPORTUNITY_GATE_STATUS)[number]

export const OPPORTUNITY_SCORING_RUN_STATUS = ['QUEUED', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED'] as const
export type OpportunityScoringRunStatus = (typeof OPPORTUNITY_SCORING_RUN_STATUS)[number]

export const OPPORTUNITY_DEADLINE_STATUS = ['OPEN', 'CLOSED', 'UNKNOWN'] as const
export type OpportunityDeadlineStatus = (typeof OPPORTUNITY_DEADLINE_STATUS)[number]

/** Requirement coverage classification (Phase 10 §7) — UNKNOWN must never be read as failure. */
export const REQUIREMENT_COVERAGE_STATUS = ['SUPPORTED', 'PARTIALLY_SUPPORTED', 'UNKNOWN', 'ACTION_REQUIRED', 'FAILED', 'NOT_APPLICABLE'] as const
export type RequirementCoverageStatus = (typeof REQUIREMENT_COVERAGE_STATUS)[number]

/** Per-criterion evaluation-fit assessment (Phase 10 §11/§43) — only ever computed from an explicit evidence link; otherwise UNKNOWN. */
export const EVALUATION_FIT_STRENGTH = ['STRONG', 'MODERATE', 'WEAK', 'UNKNOWN'] as const
export type EvaluationFitStrength = (typeof EVALUATION_FIT_STRENGTH)[number]

/** Evaluation threshold status (Phase 10 §13) — PASS is never invented; only ever UNKNOWN in this phase unless a future phase adds real bidder-side scoring. */
export const EVALUATION_THRESHOLD_STATUS = ['PASS', 'FAIL', 'UNKNOWN'] as const
export type EvaluationThresholdStatus = (typeof EVALUATION_THRESHOLD_STATUS)[number]

/** Evidence strength state (Phase 10 §14/§15) — reused verbatim for every evidence kind the engine consumes. */
export const EVIDENCE_STRENGTH_STATE = ['VERIFIED', 'UNVERIFIED', 'UNKNOWN', 'MISSING', 'EXPIRED'] as const
export type EvidenceStrengthState = (typeof EVIDENCE_STRENGTH_STATE)[number]

/** Geography match outcome (Phase 10 §20) — carries forward the Phase 7/8 textual-geography limitation unchanged; never a silent MATCH guess. */
export const GEOGRAPHY_MATCH_STATUS = ['MATCH', 'MISMATCH', 'UNKNOWN'] as const
export type GeographyMatchStatus = (typeof GEOGRAPHY_MATCH_STATUS)[number]

export const BRIEFING_GATE_STATUS = ['SATISFIED', 'UNKNOWN', 'FAILED', 'NOT_REQUIRED'] as const
export type BriefingGateStatus = (typeof BRIEFING_GATE_STATUS)[number]

/** Roles permitted to view opportunity score output (Phase 10 §37, mirrors QUALIFICATION_VIEW_ROLES). */
export const OPPORTUNITY_SCORE_VIEW_ROLES = ['ADMIN', 'BID_MANAGER', 'RESEARCHER'] as const
/** Roles permitted to trigger a scoring run (Phase 10 §37, mirrors QUALIFICATION_ACTION_ROLES). */
export const OPPORTUNITY_SCORE_ACTION_ROLES = ['ADMIN', 'BID_MANAGER'] as const
/** Roles permitted to view scoring configurations — read-only for everyone who can view scores; mutation is not exposed via any route in this phase (Phase 10 §37). */
export const OPPORTUNITY_SCORE_CONFIG_VIEW_ROLES = ['ADMIN', 'BID_MANAGER', 'RESEARCHER'] as const
