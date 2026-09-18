/**
 * Phase 15 — Final Bid Compliance, Submission Readiness & Submission
 * Pack. Mirrors proposals.ts/bidStrategy.ts exactly. Roles reuse the
 * existing RBAC roles unchanged (Phase 15 §55): ADMIN = full access;
 * BID_MANAGER = create/edit pricing, resolve issues, build pack,
 * request/perform final approval; RESEARCHER = view + resolve
 * research-related issues but never final approval; VIEWER = read-only.
 */
export const SUBMISSION_VIEW_ROLES = ['ADMIN', 'BID_MANAGER', 'RESEARCHER', 'VIEWER'] as const
export const SUBMISSION_MANAGE_ROLES = ['ADMIN', 'BID_MANAGER'] as const
export const SUBMISSION_PRICING_ROLES = ['ADMIN', 'BID_MANAGER'] as const
/** Phase 15 §38/§55 — only ADMIN/BID_MANAGER may perform the final human approval; never automated, never RESEARCHER/VIEWER. */
export const SUBMISSION_APPROVE_ROLES = ['ADMIN', 'BID_MANAGER'] as const

/**
 * Phase 15 §10 — terminal/interim states. Deliberately excludes any
 * "SUBMITTED" value (binding constraint §10/§39/§63): this system
 * never asserts a tender was actually submitted.
 */
export const SUBMISSION_READINESS_STATUS = [
  'DRAFT', 'CHECKING', 'REQUIRES_REVIEW', 'BLOCKED', 'READY_TO_SUBMIT', 'APPROVED_FOR_SUBMISSION', 'SUPERSEDED',
] as const
export type SubmissionReadinessStatus = (typeof SUBMISSION_READINESS_STATUS)[number]

/** Phase 15 §9 — minimum compliance categories; adapt per tender, never fewer. */
export const SUBMISSION_COMPLIANCE_CATEGORY = [
  'QUALIFICATION', 'MANDATORY_REQUIREMENTS', 'EVALUATION_COVERAGE', 'BRIEFING', 'ADDENDA',
  'PROPOSAL', 'EVIDENCE', 'PRICING', 'MANDATORY_DOCUMENTS', 'FORMS', 'CERTIFICATES',
  'SIGNATURES', 'FILE_FORMATS', 'FILE_NAMES', 'FILE_SIZES', 'SUBMISSION_METHOD', 'DEADLINE',
] as const
export type SubmissionComplianceCategory = (typeof SUBMISSION_COMPLIANCE_CATEGORY)[number]

/** Phase 15 §11/§25 — precedence enforced in application code only, mirrors every prior phase's engine (BLOCKED > WARNING > INFO). */
export const SUBMISSION_ITEM_SEVERITY = ['BLOCKER', 'WARNING', 'INFO'] as const
export type SubmissionItemSeverity = (typeof SUBMISSION_ITEM_SEVERITY)[number]

export const SUBMISSION_PRICING_CURRENCY = ['ZAR', 'USD', 'EUR', 'GBP'] as const
export type SubmissionPricingCurrency = (typeof SUBMISSION_PRICING_CURRENCY)[number]

export const SUBMISSION_PACK_STATUS = ['CURRENT', 'SUPERSEDED', 'INVALIDATED'] as const
export type SubmissionPackStatus = (typeof SUBMISSION_PACK_STATUS)[number]

export const SUBMISSION_APPROVAL_STATUS = ['APPROVED', 'REVOKED', 'SUPERSEDED'] as const
export type SubmissionApprovalStatus = (typeof SUBMISSION_APPROVAL_STATUS)[number]

/** Phase 15 §13 — final requirement reconciliation outcome per tender requirement. */
export const SUBMISSION_REQUIREMENT_STATUS = ['SATISFIED', 'PARTIALLY_SATISFIED', 'MISSING', 'BLOCKED', 'REQUIRES_REVIEW', 'NOT_APPLICABLE'] as const
export type SubmissionRequirementStatus = (typeof SUBMISSION_REQUIREMENT_STATUS)[number]

/** Phase 15 §21 — mandatory document lifecycle; never VERIFIED merely because a row exists. */
export const SUBMISSION_DOCUMENT_STATUS = ['REQUIRED', 'PRESENT', 'VERIFIED', 'EXPIRED', 'MISSING', 'INVALID', 'REQUIRES_REVIEW', 'NOT_REQUIRED'] as const
export type SubmissionDocumentStatus = (typeof SUBMISSION_DOCUMENT_STATUS)[number]

/** Phase 15 §24 — signature tracking, never fabricated. */
export const SUBMISSION_SIGNATURE_STATUS = ['NOT_REQUIRED', 'REQUIRED', 'PRESENT', 'MISSING', 'REQUIRES_REVIEW'] as const
export type SubmissionSignatureStatus = (typeof SUBMISSION_SIGNATURE_STATUS)[number]

/** Phase 15 §27 — deadline engine states, server time only, never browser time. */
export const SUBMISSION_DEADLINE_STATE = ['OPEN', 'CLOSING_SOON', 'CLOSED', 'UNKNOWN'] as const
export type SubmissionDeadlineState = (typeof SUBMISSION_DEADLINE_STATE)[number]

/** Phase 15 §28 — non-blocking informational deadline warnings. */
export const SUBMISSION_DEADLINE_WARNING = ['NONE', 'CLOSING_WITHIN_72_HOURS', 'CLOSING_WITHIN_24_HOURS', 'CLOSING_TODAY'] as const
export type SubmissionDeadlineWarning = (typeof SUBMISSION_DEADLINE_WARNING)[number]

/** Phase 15 §29 — submission method vocabulary; Phase 15 never performs submission itself. */
export const SUBMISSION_METHOD = ['PORTAL', 'EMAIL', 'PHYSICAL', 'HAND_DELIVERY', 'COURIER', 'OTHER', 'UNKNOWN'] as const
export type SubmissionMethod = (typeof SUBMISSION_METHOD)[number]

/** Phase 15 §31 — file naming convention outcome; NO_NAMING_RULE never blocks. */
export const SUBMISSION_FILE_NAME_RESULT = ['MATCHES_CONVENTION', 'DOES_NOT_MATCH_CONVENTION', 'NO_NAMING_RULE'] as const
export type SubmissionFileNameResult = (typeof SUBMISSION_FILE_NAME_RESULT)[number]

/**
 * Phase 15 §47 — audit event names. Deliberately excludes any
 * "SUBMISSION_COMPLETED" event (binding constraint §47) — this system
 * never asserts an external submission happened.
 */
export const SUBMISSION_AUDIT_EVENTS = [
  'FINAL_COMPLIANCE_RUN',
  'SUBMISSION_READINESS_CALCULATED',
  'SUBMISSION_BLOCKER_CREATED',
  'SUBMISSION_BLOCKER_RESOLVED',
  'SUBMISSION_PACK_CREATED',
  'SUBMISSION_PACK_VERSION_CREATED',
  'SUBMISSION_PACK_INVALIDATED',
  'SUBMISSION_MANIFEST_CREATED',
  'SUBMISSION_APPROVAL_REQUESTED',
  'SUBMISSION_APPROVED_FOR_SUBMISSION',
  'SUBMISSION_APPROVAL_REVOKED',
] as const
export type SubmissionAuditEvent = (typeof SUBMISSION_AUDIT_EVENTS)[number]
