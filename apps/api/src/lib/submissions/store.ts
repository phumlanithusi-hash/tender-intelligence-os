import type { SubmissionExecutionMethod, SubmissionExecutionStatus, SubmissionAutomationStatus, SubmissionAttemptStatus, SubmissionErrorCode, SubmissionReceiptType, SubmissionReceiptVerificationStatus, SubmissionPhysicalStage } from '@tender-os/constants'

/**
 * Phase 16 — the SubmissionExecutionStore port, mirroring
 * lib/submissionReadiness/store.ts exactly. Everything the
 * orchestration layer (runSubmission.ts) needs to prepare, confirm,
 * attempt, receive, and cancel a submission — with no I/O of its own.
 */

export interface BidContext {
  bidProjectId: string
  agencyId: string
  tenderId: string
  finalBidDecision: 'BID' | 'REVIEW' | 'NO_BID' | null
  humanOverrideToBid: boolean
  tenderClosingDate: string | null
  tenderClosingTime: string | null
  tenderSubmissionMethod: string | null
  tenderSubmissionUrl: string | null
  tenderSubmissionEmail: string | null
  documentEvidenceMethod: string | null
}

export interface ReadinessContext {
  readinessId: string | null
  status: string | null
  blockerCount: number
}

export interface PackContext {
  packId: string | null
  version: number | null
  status: 'CURRENT' | 'SUPERSEDED' | 'INVALIDATED' | null
  manifestHash: string | null
  files: Array<{ fileName: string; storagePath: string | null; mimeType: string | null; sizeBytes: number | null; sha256: string }>
}

export interface ApprovalContext {
  approvalId: string | null
  status: 'APPROVED' | 'REVOKED' | 'SUPERSEDED' | null
  packId: string | null
  readinessId: string | null
}

export interface SubmissionExecutionRecord {
  id: string
  bidProjectId: string
  agencyId: string
  tenderId: string
  status: SubmissionExecutionStatus
  submissionMethod: SubmissionExecutionMethod
  automationStatus: SubmissionAutomationStatus
  targetKind: string | null
  targetValue: string | null
  approvedReadinessId: string | null
  submissionPackId: string | null
  submissionPackVersion: number | null
  submissionPackHash: string | null
  manifestHash: string | null
  confirmedBy: string | null
  confirmedAt: string | null
  startedAt: string | null
  completedAt: string | null
  providerName: string | null
  providerReference: string | null
  externalSubmissionId: string | null
  failureCode: SubmissionErrorCode | null
  failureMessage: string | null
  retryable: boolean | null
  physicalStage: SubmissionPhysicalStage
  version: number
}

export interface ConfirmationRecord {
  id: string
  submissionExecutionId: string
  agencyId: string
  readinessId: string
  packId: string
  packVersion: number
  packHash: string
  manifestHash: string
  submissionMethod: SubmissionExecutionMethod
  targetValue: string | null
  deadlineAt: string | null
  statement: string
  confirmedBy: string
  confirmedAt: string
  invalidated: boolean
}

export interface AttemptRecord {
  id: string
  submissionExecutionId: string
  agencyId: string
  attemptNumber: number
  status: SubmissionAttemptStatus
  method: SubmissionExecutionMethod
  packId: string
  packVersion: number
  packHash: string
  manifestHash: string
  initiatedBy: string
  confirmationId: string
  idempotencyKey: string
  startedAt: string
  completedAt: string | null
  providerName: string | null
  providerReference: string | null
  externalSubmissionId: string | null
  responseStatus: string | null
  responseCode: string | null
  errorCode: SubmissionErrorCode | null
  errorMessage: string | null
  retryable: boolean | null
  humanActionRequired: boolean
}

export interface ReceiptRecord {
  id: string
  submissionExecutionId: string
  attemptId: string | null
  agencyId: string
  receiptType: SubmissionReceiptType
  providerName: string | null
  providerReference: string | null
  receiptUrl: string | null
  receiptFile: string | null
  receiptHash: string | null
  issuedAt: string | null
  capturedAt: string
  capturedBy: string | null
  verificationStatus: SubmissionReceiptVerificationStatus
  notes: string | null
}

export interface SubmissionExecutionStore {
  getBidContext(bidProjectId: string, agencyId: string): Promise<BidContext | null>
  getReadinessContext(bidProjectId: string): Promise<ReadinessContext>
  getPackContext(bidProjectId: string): Promise<PackContext>
  getApprovalContext(bidProjectId: string): Promise<ApprovalContext>

  getExecution(bidProjectId: string): Promise<SubmissionExecutionRecord | null>
  upsertExecution(bidProjectId: string, agencyId: string, tenderId: string, patch: Partial<SubmissionExecutionRecord>, expectedVersion: number | null): Promise<SubmissionExecutionRecord>

  listConfirmations(submissionExecutionId: string): Promise<ConfirmationRecord[]>
  getLatestActiveConfirmation(submissionExecutionId: string): Promise<ConfirmationRecord | null>
  createConfirmation(input: Omit<ConfirmationRecord, 'id' | 'invalidated' | 'confirmedAt'> & { confirmedAt?: string }): Promise<ConfirmationRecord>
  invalidateConfirmation(confirmationId: string, agencyId: string, reason: string): Promise<void>

  listAttempts(submissionExecutionId: string): Promise<AttemptRecord[]>
  getActiveAttempt(submissionExecutionId: string): Promise<AttemptRecord | null>
  createAttempt(input: Omit<AttemptRecord, 'id' | 'status' | 'completedAt' | 'providerName' | 'providerReference' | 'externalSubmissionId' | 'responseStatus' | 'responseCode' | 'errorCode' | 'errorMessage' | 'retryable' | 'humanActionRequired'>): Promise<AttemptRecord>
  completeAttempt(attemptId: string, agencyId: string, patch: { status: SubmissionAttemptStatus; providerName: string | null; providerReference: string | null; externalSubmissionId: string | null; responseStatus: string | null; responseCode: string | null; errorCode: SubmissionErrorCode | null; errorMessage: string | null; retryable: boolean | null; humanActionRequired: boolean }): Promise<AttemptRecord>

  listReceipts(submissionExecutionId: string): Promise<ReceiptRecord[]>
  createReceipt(input: Omit<ReceiptRecord, 'id' | 'capturedAt'> & { capturedAt?: string }): Promise<ReceiptRecord>
  updateReceiptVerification(receiptId: string, agencyId: string, verificationStatus: SubmissionReceiptVerificationStatus, notes: string | null): Promise<ReceiptRecord>

  writeAuditEvent(event: { eventType: string; agencyId: string; actorId: string | null; entityId: string; oldValue: Record<string, unknown> | null; newValue: Record<string, unknown> | null }): Promise<void>
}
