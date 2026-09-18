/**
 * Phase 8 — Qualification & Compliance Intelligence enums, kept in
 * exact sync with database/migrations/20260911160000_qualification.sql.
 *
 * These are the vocabulary for the deterministic qualification engine
 * (apps/api/src/lib/qualification/) and the QualificationInterpretationAgent
 * (apps/api/src/lib/ai/agents/qualification/). AI may only ever
 * populate category/ruleType/mandatoryStatus — never the qualification
 * result state itself (docs/QUALIFICATION-ENGINE.md "AI Boundary").
 */

/** Every qualification CHECK resolves to exactly one of these (Phase 8 §3). Never collapse UNKNOWN into FAIL or REQUIRES_ACTION into PASS. */
export const QUALIFICATION_CHECK_STATUS = ['PASS', 'FAIL', 'UNKNOWN', 'REQUIRES_ACTION'] as const
export type QualificationCheckStatus = (typeof QUALIFICATION_CHECK_STATUS)[number]

/** Mandatory status of a requirement (Phase 8 §4). Never inferred just because a requirement "sounds important". */
export const QUALIFICATION_MANDATORY_STATUS = [
  'MANDATORY',
  'CONDITIONALLY_MANDATORY',
  'PREFERENTIAL',
  'INFORMATIONAL',
  'UNKNOWN',
] as const
export type QualificationMandatoryStatus = (typeof QUALIFICATION_MANDATORY_STATUS)[number]

/** Overall qualification status for a tender+agency (Phase 8 §25). Precedence: NOT_ELIGIBLE > REQUIRES_REVIEW > ACTION_REQUIRED > UNKNOWN > ELIGIBLE. */
export const QUALIFICATION_OVERALL_STATUS = [
  'ELIGIBLE',
  'NOT_ELIGIBLE',
  'REQUIRES_REVIEW',
  'ACTION_REQUIRED',
  'UNKNOWN',
] as const
export type QualificationOverallStatus = (typeof QUALIFICATION_OVERALL_STATUS)[number]

/** Qualification requirement categories (Phase 8 §5). Configurable vocabulary, not hard-coded into UI-only logic. */
export const QUALIFICATION_CATEGORY = [
  'CSD',
  'TAX',
  'B_BBEE',
  'COMPANY_REGISTRATION',
  'YEARS_IN_BUSINESS',
  'TURNOVER',
  'RELEVANT_EXPERIENCE',
  'REFERENCES',
  'PROFESSIONAL_REGISTRATION',
  'CERTIFICATION',
  'INSURANCE',
  'KEY_PERSONNEL',
  'CAPACITY',
  'EQUIPMENT',
  'GEOGRAPHIC',
  'COMPULSORY_BRIEFING',
  'JV_SUBCONTRACTING',
  'FINANCIAL',
  'MANDATORY_FORM',
  'DECLARATION',
  'SIGNATURE',
  'SUBMISSION',
  'OTHER',
  'UNKNOWN',
] as const
export type QualificationCategory = (typeof QUALIFICATION_CATEGORY)[number]

/** Requirement rule types, one per rules/*.ts module (Phase 8 §10). */
export const QUALIFICATION_RULE_TYPE = [
  'BOOLEAN',
  'NUMERIC_MIN',
  'NUMERIC_MAX',
  'DATE',
  'DATE_EXPIRY',
  'ENUM',
  'TEXT',
  'DOCUMENT',
  'EXPERIENCE',
  'REFERENCE',
  'BRIEFING',
  'COMPOSITE',
  'MANUAL_REVIEW',
] as const
export type QualificationRuleType = (typeof QUALIFICATION_RULE_TYPE)[number]

/** Provenance of a requirement's evidence (Phase 7 truth-state convention, reused per Phase 8 §7). */
export const QUALIFICATION_SOURCE_TRUTH = ['FACT', 'INFERENCE', 'UNKNOWN', 'UNVERIFIED'] as const
export type QualificationSourceTruth = (typeof QUALIFICATION_SOURCE_TRUTH)[number]

/** Whether a requirement row is a verified structured requirement, a provisional AI-suggested candidate, needs human review, or (Phase 9 §28) has a genuine CONFLICT between two authoritative documents. Also reused as-is for tender_evaluation_criteria.status (Phase 9 §17). */
export const QUALIFICATION_REQUIREMENT_STATUS = ['VERIFIED', 'PROVISIONAL', 'REQUIRES_REVIEW', 'CONFLICT'] as const
export type QualificationRequirementStatus = (typeof QUALIFICATION_REQUIREMENT_STATUS)[number]

/** Who/what produced a compliance check result (Phase 8 §30). AI_ASSISTED is interpretation metadata only — never a state decision. */
export const QUALIFICATION_EVALUATED_BY = ['DETERMINISTIC_RULE', 'AI_ASSISTED', 'MANUAL'] as const
export type QualificationEvaluatedBy = (typeof QUALIFICATION_EVALUATED_BY)[number]

export const QUALIFICATION_ACTION_PRIORITY = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const
export type QualificationActionPriority = (typeof QUALIFICATION_ACTION_PRIORITY)[number]

export const QUALIFICATION_ACTION_STATUS = ['OPEN', 'IN_PROGRESS', 'DONE', 'DISMISSED'] as const
export type QualificationActionStatus = (typeof QUALIFICATION_ACTION_STATUS)[number]

/** Agency document status (Phase 8 §9) — reuses `evidence_status` (VERIFIED/INFERRED/UNVERIFIED/UNKNOWN) from Phase 2 where possible; this adds document-lifecycle states not covered by that vocabulary. */
export const AGENCY_DOCUMENT_LIFECYCLE_STATUS = ['VALID', 'EXPIRED', 'MISSING', 'PENDING_VERIFICATION', 'REJECTED', 'UNKNOWN'] as const
export type AgencyDocumentLifecycleStatus = (typeof AGENCY_DOCUMENT_LIFECYCLE_STATUS)[number]

export const QUALIFICATION_RUN_STATUS = ['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED'] as const
export type QualificationRunStatus = (typeof QUALIFICATION_RUN_STATUS)[number]

export const QUALIFICATION_CONFLICT_STATUS = ['OPEN', 'RESOLVED'] as const
export type QualificationConflictStatus = (typeof QUALIFICATION_CONFLICT_STATUS)[number]

/** Roles permitted to view qualification output (Phase 8 §33, mirrors AI_VIEW_ROLES). */
export const QUALIFICATION_VIEW_ROLES = ['ADMIN', 'BID_MANAGER', 'RESEARCHER'] as const
/** Roles permitted to trigger evaluation or record a human review decision (Phase 8 §33, mirrors AI_ACTION_ROLES). */
export const QUALIFICATION_ACTION_ROLES = ['ADMIN', 'BID_MANAGER'] as const
