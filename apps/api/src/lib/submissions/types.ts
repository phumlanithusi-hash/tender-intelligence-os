import type {
  SubmissionAttemptStatus,
  SubmissionAutomationStatus,
  SubmissionDeadlineUrgency,
  SubmissionErrorCode,
  SubmissionExecutionMethod,
  SubmissionExecutionStatus,
  SubmissionMethodConfidence,
  SubmissionPhysicalStage,
  SubmissionReceiptType,
} from '@tender-os/constants'

/**
 * Phase 16 §13 — the pure-function contracts for the submission
 * execution engine. Every function in lib/submissions/*.ts (other than
 * the store/adapter implementations) is pure and zero-I/O, mirroring
 * lib/submissionReadiness/engine.ts exactly: no Date.now(), no
 * Supabase, no network. All "now" comes in as `nowIso`.
 */

// ---------------------------------------------------------------------
// Method resolution (§12)
// ---------------------------------------------------------------------
export interface MethodResolutionInput {
  tenderSubmissionMethod: string | null
  tenderSubmissionUrl: string | null
  tenderSubmissionEmail: string | null
  /** Method mentioned in tender document evidence (extracted text), if any — deterministic string match only, never AI (§12). */
  documentEvidenceMethod: string | null
  /** A human has explicitly confirmed/overridden the method for this bid. */
  manuallyConfirmedMethod: SubmissionExecutionMethod | null
  /** Adapter registry: methods this deployment has a real (even if MANUAL_REQUIRED) adapter for. */
  supportedMethods: readonly SubmissionExecutionMethod[]
}

export interface MethodResolutionResult {
  method: SubmissionExecutionMethod
  confidence: SubmissionMethodConfidence
  automationStatus: SubmissionAutomationStatus
  target: string | null
  reason: string
  /** True when the tender record and document evidence disagree — the UI must ask a human to confirm the authoritative method (§12). */
  requiresReview: boolean
}

// ---------------------------------------------------------------------
// Deadline urgency (§11) — distinct thresholds from Phase 15's readiness engine.
// ---------------------------------------------------------------------
export interface DeadlineUrgencyResult {
  urgency: SubmissionDeadlineUrgency
  hoursRemaining: number | null
}

// ---------------------------------------------------------------------
// Pre-submission validation gate (§10)
// ---------------------------------------------------------------------
export interface PreflightInput {
  bidExists: boolean
  bidBelongsToAgency: boolean
  finalBidDecision: 'BID' | 'REVIEW' | 'NO_BID' | null
  humanOverrideToBid: boolean
  readinessStatus: string | null
  approvalStatus: 'APPROVED' | 'REVOKED' | 'SUPERSEDED' | null
  approvalReferencesCurrentPack: boolean
  approvalReferencesCurrentReadiness: boolean
  packExists: boolean
  packSuperseded: boolean
  packHashMatches: boolean
  manifestHashMatches: boolean
  requiredFilesPresent: boolean
  hasMandatoryComplianceBlocker: boolean
  nowIso: string
  tenderClosingDate: string | null
  tenderClosingTime: string | null
  hasExistingConfirmedSubmission: boolean
  explicitDuplicateOverride: boolean
}

export type PreflightBlockCode =
  | 'BID_NOT_FOUND'
  | 'CROSS_AGENCY'
  | 'NO_BID_DECISION'
  | 'READINESS_NOT_READY'
  | 'NO_VALID_APPROVAL'
  | 'APPROVAL_STALE'
  | 'PACK_MISSING'
  | 'PACK_SUPERSEDED'
  | 'PACK_HASH_MISMATCH'
  | 'MANIFEST_HASH_MISMATCH'
  | 'REQUIRED_FILES_MISSING'
  | 'MANDATORY_COMPLIANCE_BLOCKER'
  | 'DEADLINE_PASSED'
  | 'DUPLICATE_SUBMISSION_RISK'

export interface PreflightResult {
  allowed: boolean
  blockers: PreflightBlockCode[]
}

// ---------------------------------------------------------------------
// Confirmation validity (§8/§9)
// ---------------------------------------------------------------------
export interface ConfirmationValidityInput {
  confirmationPackId: string
  confirmationPackVersion: number
  confirmationPackHash: string
  confirmationManifestHash: string
  confirmationReadinessId: string
  currentPackId: string | null
  currentPackVersion: number | null
  currentPackHash: string | null
  currentManifestHash: string | null
  currentReadinessId: string | null
  confirmationInvalidated: boolean
}

// ---------------------------------------------------------------------
// Retry safety (§23)
// ---------------------------------------------------------------------
export type RetryDecision = 'SAFE_TO_RETRY' | 'UNSAFE_REQUIRES_VERIFICATION' | 'NOT_RETRYABLE'

export interface RetrySafetyInput {
  lastAttemptStatus: SubmissionAttemptStatus
  lastAttemptErrorCode: SubmissionErrorCode | null
  /** True only when the adapter has deterministic proof the provider never received the previous attempt (e.g. rejected before any network call was made). */
  adapterConfirmedNotReceived: boolean
  explicitHumanConfirmation: boolean
}

// ---------------------------------------------------------------------
// Receipt verification (§20)
// ---------------------------------------------------------------------
export interface ReceiptVerificationInput {
  receiptType: SubmissionReceiptType
  /** True when the receipt/reference was produced by the provider itself (a downloaded portal receipt, an email message-id, a courier tracking number confirmed against the courier's own system) rather than merely typed in by a user. */
  providerIssued: boolean
  /** True when a second, independent piece of evidence corroborates this one (e.g. a portal receipt AND a procurement reference agree). */
  corroborated: boolean
  /** True when two captured receipts for the same submission disagree (different reference numbers claiming the same event). */
  conflictsWithAnotherReceipt: boolean
}

// ---------------------------------------------------------------------
// Submission status resolver (§37) — the single source of truth for
// the aggregate execution status. Precedence is fixed and exhaustive.
// ---------------------------------------------------------------------
export interface StatusResolutionInput {
  readinessBlocked: boolean
  approvalMissingOrInvalid: boolean
  packInvalid: boolean
  method: SubmissionExecutionMethod
  automationStatus: SubmissionAutomationStatus
  confirmationRequired: boolean
  attemptActive: boolean
  verifiedReceiptExists: boolean
  humanReportedWithoutVerifiedEvidence: boolean
  lastAttemptFailedRetrySafe: boolean
  lastAttemptOutcomeUnknown: boolean
  cancelled: boolean
  superseded: boolean
}

export interface StatusResolutionResult {
  status: SubmissionExecutionStatus
  reason: string
}

// ---------------------------------------------------------------------
// Physical/courier lifecycle (§17)
// ---------------------------------------------------------------------
export interface PhysicalTransitionInput {
  currentStage: SubmissionPhysicalStage
  targetStage: SubmissionPhysicalStage
  hasDispatchEvidence: boolean
  hasDeliveryEvidence: boolean
  hasProofOfDelivery: boolean
  hasHumanAttestation: boolean
}

export interface PhysicalTransitionResult {
  allowed: boolean
  reason: string
}
