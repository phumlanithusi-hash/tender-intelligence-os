/**
 * Phase 11 — Bid/No-Bid Intelligence Engine vocabulary.
 *
 * NAMING/SEPARATION NOTE (binding constraint — see docs/DECISIONS.md,
 * same discipline Phase 10 documented for its own collision):
 *   - `BID_RECOMMENDATION` (BID/NO_BID/REVIEW) is a completely NEW,
 *     separately-named vocabulary. It must never be confused with the
 *     pre-existing Phase 2/3 `bid_decision` enum
 *     (PRIORITY_BID/BID/REVIEW/CONDITIONAL/NO_BID/UNDECIDED, exposed via
 *     shared/constants/src/provenance.ts `BID_DECISION` and
 *     `bid_projects.decision`) — that column is a simple, unstructured
 *     human field with no rule engine behind it; this phase's engine is
 *     the opposite (fully deterministic, rule-explained). The two are
 *     stored in entirely different tables and never merged.
 *   - Also distinct from Phase 10's `OPPORTUNITY_DECISION_SIGNAL`
 *     (HIGH_PRIORITY/PROMISING/REVIEW/LOW_PRIORITY/BLOCKED/
 *     INSUFFICIENT_DATA) — that is "how attractive", this is "should we
 *     pursue". A tender can be HIGH_PRIORITY (Phase 10) and REVIEW
 *     (Phase 11) at the same time; this is expected, not a bug.
 */

/** The only three possible Bid/No-Bid engine outputs (Phase 11 §4). */
export const BID_RECOMMENDATION = ['BID', 'NO_BID', 'REVIEW'] as const
export type BidRecommendation = (typeof BID_RECOMMENDATION)[number]

/** Structured rule evaluation status (Phase 11 §30) — always populated, even for UNKNOWN. */
export const BID_RULE_STATUS = ['PASS', 'FAIL', 'UNKNOWN'] as const
export type BidRuleStatus = (typeof BID_RULE_STATUS)[number]

/** Rule severity (Phase 11 §28). HARD_BLOCK and NO_BID both drive an immediate NO_BID once triggered; the distinction is purely descriptive (HARD_BLOCK = an unconditional gate, NO_BID = a configured business threshold) — both are recorded so the explanation can say which kind of rule fired. */
export const BID_RULE_SEVERITY = ['HARD_BLOCK', 'NO_BID', 'REVIEW', 'WARNING'] as const
export type BidRuleSeverity = (typeof BID_RULE_SEVERITY)[number]

/** Decision precedence buckets, in order (Phase 11 §7) — stored in policy configuration, never scattered in code. */
export const BID_DECISION_PRECEDENCE_STEP = [
  'CONFIRMED_NO_BID_RULE',
  'CLOSED_TENDER',
  'NOT_ELIGIBLE',
  'CONFIRMED_MANDATORY_FAILURE',
  'CONFIRMED_SUBMISSION_IMPOSSIBILITY',
  'QUALIFICATION_BLOCKER',
  'MATERIAL_UNRESOLVED_RISK',
  'INSUFFICIENT_DATA',
  'POSITIVE_BID_RULE',
  'DEFAULT_REVIEW',
] as const
export type BidDecisionPrecedenceStep = (typeof BID_DECISION_PRECEDENCE_STEP)[number]

/** Bid effort classification (Phase 11 §24/§25) — deterministic, never a score, never AI-judged. */
export const BID_EFFORT_LEVEL = ['LOW', 'MEDIUM', 'HIGH', 'UNKNOWN'] as const
export type BidEffortLevel = (typeof BID_EFFORT_LEVEL)[number]

/** Per-unknown-type rule severity (Phase 11 §16) — never uniform. */
export const BID_UNKNOWN_FACTOR = [
  'COMMERCIAL_VALUE',
  'STRATEGIC_FIT',
  'BRIEFING_ATTENDANCE',
  'EVALUATION_CONFLICT',
  'DEADLINE',
] as const
export type BidUnknownFactor = (typeof BID_UNKNOWN_FACTOR)[number]
export const BID_UNKNOWN_SEVERITY = ['REVIEW', 'CONTINUE'] as const
export type BidUnknownSeverity = (typeof BID_UNKNOWN_SEVERITY)[number]

export const BID_DECISION_RUN_STATUS = ['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED'] as const
export type BidDecisionRunStatus = (typeof BID_DECISION_RUN_STATUS)[number]

/** Future outcome-learning seam (Phase 11 §61/§62) — schema only, never populated or inferred by this phase. */
export const BID_DECISION_OUTCOME = ['AWARD', 'LOSS', 'CANCELLED', 'NO_OUTCOME'] as const
export type BidDecisionOutcome = (typeof BID_DECISION_OUTCOME)[number]

/** Audit event types (Phase 11 §63), written to the existing generic `audit_logs` table (Phase 2 §22) via `entity_type = 'bid_decision_run'` / `'bid_policy'`. */
export const BID_DECISION_AUDIT_EVENT = [
  'BID_DECISION_CREATED',
  'BID_DECISION_RECALCULATED',
  'BID_DECISION_OVERRIDDEN',
  'BID_DECISION_MARKED_STALE',
  'BID_POLICY_CHANGED',
] as const
export type BidDecisionAuditEvent = (typeof BID_DECISION_AUDIT_EVENT)[number]

/** Roles permitted to view a bid decision (Phase 11 §36/§46). */
export const BID_DECISION_VIEW_ROLES = ['ADMIN', 'BID_MANAGER', 'RESEARCHER'] as const
/** Roles permitted to trigger a bid-decision evaluation run (Phase 11 §46). */
export const BID_DECISION_EVALUATE_ROLES = ['ADMIN', 'BID_MANAGER'] as const
/** Roles permitted to override a decision (Phase 11 §36) — RESEARCHER is view-only. */
export const BID_DECISION_OVERRIDE_ROLES = ['ADMIN', 'BID_MANAGER'] as const
/** Roles permitted to view/manage bid policy configuration. */
export const BID_POLICY_VIEW_ROLES = ['ADMIN', 'BID_MANAGER', 'RESEARCHER'] as const
