/**
 * Phase 12 — Bid Strategy & Bid Project Intelligence. Mirrors the
 * bidDecision.ts constants file exactly. Roles reuse the existing
 * RBAC roles from Phase 4/7/8/10/11 unchanged (Phase 12 §24):
 * ADMIN = full access, BID_MANAGER = create/edit strategy, assign
 * tasks, approve strategy, manage project; RESEARCHER = view + add
 * research/evidence notes, never approve.
 */
export const BID_STRATEGY_VIEW_ROLES = ['ADMIN', 'BID_MANAGER', 'RESEARCHER'] as const
export const BID_STRATEGY_MANAGE_ROLES = ['ADMIN', 'BID_MANAGER'] as const
export const BID_STRATEGY_APPROVE_ROLES = ['ADMIN', 'BID_MANAGER'] as const
/** Phase 12 §5 — creating a Bid Project from a REVIEW final decision requires this role AND an explicit confirmation flag. */
export const BID_PROJECT_REVIEW_OVERRIDE_ROLES = ['ADMIN', 'BID_MANAGER'] as const

export const BID_PROJECT_STATUS = ['DRAFT', 'STRATEGY', 'IN_PROGRESS', 'INTERNAL_REVIEW', 'READY_FOR_SUBMISSION', 'SUBMITTED', 'CLOSED', 'CANCELLED'] as const
export type BidProjectStatus = (typeof BID_PROJECT_STATUS)[number]

/** Phase 12 §4 — explicit transition map, no arbitrary transitions. */
export const BID_PROJECT_TRANSITIONS: Record<BidProjectStatus, BidProjectStatus[]> = {
  DRAFT: ['STRATEGY', 'CANCELLED'],
  STRATEGY: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['INTERNAL_REVIEW', 'CANCELLED'],
  INTERNAL_REVIEW: ['READY_FOR_SUBMISSION', 'IN_PROGRESS'],
  READY_FOR_SUBMISSION: ['SUBMITTED', 'IN_PROGRESS'],
  SUBMITTED: ['CLOSED'],
  CLOSED: [],
  CANCELLED: [],
}

export const BID_PROJECT_PRIORITY = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const
export type BidProjectPriority = (typeof BID_PROJECT_PRIORITY)[number]

export const BID_STRATEGY_STATUS = ['DRAFT', 'IN_REVIEW', 'APPROVED', 'SUPERSEDED'] as const
export type BidStrategyStatus = (typeof BID_STRATEGY_STATUS)[number]

export const BID_WIN_THEME_SOURCE_TYPE = ['TENDER_REQUIREMENT', 'EVALUATION_CRITERION', 'AGENCY_CAPABILITY', 'AGENCY_DIFFERENTIATOR', 'HUMAN_DEFINED'] as const
export type BidWinThemeSourceType = (typeof BID_WIN_THEME_SOURCE_TYPE)[number]

/** Shared evidence-support vocabulary for win themes and differentiators (Phase 12 §8/§9). Never invented as SUPPORTED without a real evidence count. */
export const BID_EVIDENCE_SUPPORT_STATUS = ['UNKNOWN', 'EVIDENCE_REQUIRED', 'SUPPORTED', 'PARTIALLY_SUPPORTED', 'UNVERIFIED'] as const
export type BidEvidenceSupportStatus = (typeof BID_EVIDENCE_SUPPORT_STATUS)[number]

export const BID_PRIORITY_CLASS = ['CLIENT', 'TENDER'] as const
export type BidPriorityClass = (typeof BID_PRIORITY_CLASS)[number]

export const BID_REQUIREMENT_RESPONSE_TYPE = ['COMPLY', 'EXPLAIN', 'PROVIDE_DOCUMENT', 'PROVIDE_EVIDENCE', 'CLARIFY', 'REQUIRES_HUMAN_REVIEW', 'NOT_APPLICABLE'] as const
export type BidRequirementResponseType = (typeof BID_REQUIREMENT_RESPONSE_TYPE)[number]

export const BID_REQUIREMENT_RESPONSE_STATUS = ['NOT_STARTED', 'IN_PROGRESS', 'READY', 'BLOCKED', 'REVIEW'] as const
export type BidRequirementResponseStatus = (typeof BID_REQUIREMENT_RESPONSE_STATUS)[number]

export const BID_EVIDENCE_NEED_STATUS = ['OPEN', 'PARTIALLY_SATISFIED', 'SATISFIED', 'BLOCKED', 'WAIVED'] as const
export type BidEvidenceNeedStatus = (typeof BID_EVIDENCE_NEED_STATUS)[number]

/** Deterministic, rule-based severity — never an "AI confidence" score (Phase 12 §16). */
export const BID_GAP_SEVERITY = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const
export type BidGapSeverity = (typeof BID_GAP_SEVERITY)[number]

export const BID_WORKSTREAM_CATEGORY = ['STRATEGY', 'CONTENT', 'DESIGN', 'CASE_STUDIES', 'COMMERCIAL', 'COMPLIANCE', 'LEGAL', 'PRODUCTION', 'APPROVAL', 'SUBMISSION'] as const
export type BidWorkstreamCategory = (typeof BID_WORKSTREAM_CATEGORY)[number]

export const BID_TASK_TYPE = ['RESEARCH', 'CONTENT', 'EVIDENCE', 'DESIGN', 'COMPLIANCE', 'APPROVAL', 'COMMERCIAL', 'SUBMISSION'] as const
export type BidTaskType = (typeof BID_TASK_TYPE)[number]

export const BID_TASK_STATUS = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'DONE', 'CANCELLED'] as const
export type BidTaskStatus = (typeof BID_TASK_STATUS)[number]

export const BID_MILESTONE_STATUS = ['UPCOMING', 'IN_PROGRESS', 'AT_RISK', 'COMPLETED', 'MISSED'] as const
export type BidMilestoneStatus = (typeof BID_MILESTONE_STATUS)[number]

/** Phase 12 §19 — the exact deterministic AT_RISK rule: due within this many days, and still not completed. Documented here so it is never re-invented ad hoc elsewhere. */
export const BID_MILESTONE_AT_RISK_WINDOW_DAYS = 5

export const BID_QUESTION_STATUS = ['DRAFT', 'INTERNAL_REVIEW', 'READY_TO_SEND', 'SUBMITTED', 'ANSWERED', 'CLOSED'] as const
export type BidQuestionStatus = (typeof BID_QUESTION_STATUS)[number]

export const BID_RISK_STATUS = ['OPEN', 'MITIGATING', 'RESOLVED', 'ACCEPTED'] as const
export type BidRiskStatus = (typeof BID_RISK_STATUS)[number]

export const BID_ASSUMPTION_STATUS = ['UNCONFIRMED', 'CONFIRMED', 'REJECTED'] as const
export type BidAssumptionStatus = (typeof BID_ASSUMPTION_STATUS)[number]

export const BID_READINESS_STATUS = ['READY', 'BLOCKED', 'REVIEW'] as const
export type BidReadinessStatus = (typeof BID_READINESS_STATUS)[number]

/** Generic "where did this structured item come from" tag, reused across win themes, evidence needs, risks and assumptions. */
export const BID_SOURCE_TYPE = ['TENDER_REQUIREMENT', 'EVALUATION_CRITERION', 'QUALIFICATION_RESULT', 'AGENCY_EVIDENCE', 'AGENCY_CAPABILITY', 'BID_DECISION', 'OPPORTUNITY_SCORE', 'CLOSING_DATE', 'BRIEFING', 'HUMAN_DEFINED'] as const
export type BidSourceType = (typeof BID_SOURCE_TYPE)[number]
