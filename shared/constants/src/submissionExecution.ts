/**
 * Phase 16 — Submission Execution, Submission Tracking & Receipt
 * Intelligence. Mirrors shared/constants/src/submissionReadiness.ts
 * exactly: enum source of truth shared between frontend and backend.
 *
 * Phase 16 §5/§10/§39/§62 binding constraint: this system asserts
 * SUBMITTED only when independently-captured/verified evidence
 * supports it. A human saying "I submitted it" produces
 * SUBMISSION_REPORTED, never SUBMITTED.
 */

/** Phase 16 §2 — submission methods; concepts must exist even where an exact real-world adapter does not. */
export const SUBMISSION_EXECUTION_METHOD = ['PORTAL', 'EMAIL', 'PHYSICAL_COURIER', 'PHYSICAL_HAND_DELIVERY', 'API', 'OTHER', 'UNKNOWN'] as const
export type SubmissionExecutionMethod = (typeof SUBMISSION_EXECUTION_METHOD)[number]

/** Phase 16 §2 — automation capability per method; UI must make this distinction obvious (§2/§30). */
export const SUBMISSION_AUTOMATION_STATUS = ['AUTOMATION_AVAILABLE', 'MANUAL_REQUIRED', 'UNSUPPORTED', 'UNKNOWN'] as const
export type SubmissionAutomationStatus = (typeof SUBMISSION_AUTOMATION_STATUS)[number]

/**
 * Phase 16 §5 — the submission state machine. Deliberately keeps
 * SUBMISSION_REPORTED distinct from SUBMITTED (§5/§62 binding
 * constraint): the former is a human report, the latter requires
 * verified evidence.
 */
export const SUBMISSION_EXECUTION_STATUS = [
  'NOT_READY',
  'READY_FOR_SUBMISSION',
  'AWAITING_HUMAN_CONFIRMATION',
  'SUBMITTING',
  'SUBMITTED',
  'SUBMISSION_REPORTED',
  'FAILED',
  'REQUIRES_MANUAL_ACTION',
  'SUPERSEDED',
  'CANCELLED',
] as const
export type SubmissionExecutionStatus = (typeof SUBMISSION_EXECUTION_STATUS)[number]

/** Phase 16 §7 — one append-only row per attempt. */
export const SUBMISSION_ATTEMPT_STATUS = ['STARTED', 'SUCCEEDED', 'FAILED', 'UNKNOWN_OUTCOME', 'REQUIRES_MANUAL_ACTION', 'CANCELLED'] as const
export type SubmissionAttemptStatus = (typeof SUBMISSION_ATTEMPT_STATUS)[number]

/** Phase 16 §24 — structured error classification; every code carries a fixed retryable/human-action-required verdict (submissions/errorClassification.ts). */
export const SUBMISSION_ERROR_CODE = [
  'AUTHENTICATION_REQUIRED',
  'AUTHORIZATION_FAILED',
  'CAPTCHA_REQUIRED',
  'MFA_REQUIRED',
  'PORTAL_UNAVAILABLE',
  'NETWORK_ERROR',
  'TIMEOUT',
  'DEADLINE_PASSED',
  'PACK_CHANGED',
  'READINESS_INVALID',
  'TARGET_INVALID',
  'ATTACHMENT_INVALID',
  'PROVIDER_REJECTED',
  'DUPLICATE_RISK',
  'UNKNOWN_PROVIDER_RESULT',
  'MANUAL_ACTION_REQUIRED',
  'UNSUPPORTED_METHOD',
  'UNKNOWN',
] as const
export type SubmissionErrorCode = (typeof SUBMISSION_ERROR_CODE)[number]

/** Phase 16 §19 — receipt intelligence: what kind of evidence was captured. */
export const SUBMISSION_RECEIPT_TYPE = [
  'PORTAL_RECEIPT',
  'EMAIL_MESSAGE_ID',
  'EMAIL_DELIVERY_CONFIRMATION',
  'COURIER_TRACKING',
  'PROOF_OF_DELIVERY',
  'PROCUREMENT_REFERENCE',
  'MANUAL_ATTESTATION',
  'OTHER',
] as const
export type SubmissionReceiptType = (typeof SUBMISSION_RECEIPT_TYPE)[number]

/** Phase 16 §20 — verification is never fabricated: a user-entered reference alone is UNVERIFIED, never VERIFIED. */
export const SUBMISSION_RECEIPT_VERIFICATION_STATUS = ['MISSING', 'CAPTURED', 'VERIFIED', 'UNVERIFIED', 'CONFLICTING'] as const
export type SubmissionReceiptVerificationStatus = (typeof SUBMISSION_RECEIPT_VERIFICATION_STATUS)[number]

/** Phase 16 §17 — physical/courier lifecycle; DISPATCHED never implies SUBMITTED. */
export const SUBMISSION_PHYSICAL_STAGE = ['NOT_STARTED', 'PREPARED', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'SUBMISSION_REPORTED', 'SUBMITTED'] as const
export type SubmissionPhysicalStage = (typeof SUBMISSION_PHYSICAL_STAGE)[number]

/** Phase 16 §11 — deadline-warning thresholds distinct from Phase 15's readiness-engine warnings (§28's 72h/24h) — this is the submission-execution-facing scale (§11 binding constraint: >24h/≤24h/≤2h/≤30min/passed). */
export const SUBMISSION_DEADLINE_URGENCY = ['NORMAL', 'CLOSING_SOON', 'URGENT', 'CRITICAL', 'BLOCKED'] as const
export type SubmissionDeadlineUrgency = (typeof SUBMISSION_DEADLINE_URGENCY)[number]

/** Phase 16 §12 — method-resolution confidence; never AI-derived (§12/§39). */
export const SUBMISSION_METHOD_CONFIDENCE = ['CONFIRMED', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'] as const
export type SubmissionMethodConfidence = (typeof SUBMISSION_METHOD_CONFIDENCE)[number]

/** Phase 16 §41 — truth labelling, carried forward from every prior phase. */
export const SUBMISSION_TRUTH_LABEL = ['VERIFIED', 'INFERRED', 'UNKNOWN', 'UNVERIFIED'] as const
export type SubmissionTruthLabel = (typeof SUBMISSION_TRUTH_LABEL)[number]

/**
 * Phase 16 §25 — audit event names. No "SUBMISSION_COMPLETED"-style
 * event that would assert a real external outcome without evidence.
 */
export const SUBMISSION_EXECUTION_AUDIT_EVENTS = [
  'SUBMISSION_PREPARED',
  'SUBMISSION_CONFIRMATION_REQUESTED',
  'SUBMISSION_CONFIRMED',
  'SUBMISSION_ATTEMPT_STARTED',
  'SUBMISSION_ATTEMPT_COMPLETED',
  'SUBMISSION_ATTEMPT_FAILED',
  'SUBMISSION_RECEIPT_CAPTURED',
  'SUBMISSION_RECEIPT_VERIFIED',
  'SUBMISSION_MARKED_MANUAL',
  'SUBMISSION_REPORTED',
  'SUBMISSION_APPROVAL_INVALIDATED',
  'SUBMISSION_CANCELLED',
] as const
export type SubmissionExecutionAuditEvent = (typeof SUBMISSION_EXECUTION_AUDIT_EVENTS)[number]

/**
 * Phase 16 §26/§55 — RBAC. Viewing is always less privileged than
 * submitting/confirming (§52 binding constraint); only ADMIN/BID_MANAGER
 * may confirm-and-submit or record a manual completion, mirroring
 * Phase 15's SUBMISSION_APPROVE_ROLES exactly.
 */
export const SUBMISSION_EXECUTION_VIEW_ROLES = ['ADMIN', 'BID_MANAGER', 'RESEARCHER', 'VIEWER'] as const
export const SUBMISSION_EXECUTION_MANAGE_ROLES = ['ADMIN', 'BID_MANAGER'] as const
export const SUBMISSION_EXECUTION_CONFIRM_ROLES = ['ADMIN', 'BID_MANAGER'] as const
