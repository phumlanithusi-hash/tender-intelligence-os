import { createHash } from 'node:crypto'
import type { SubmissionExecutionMethod } from '@tender-os/constants'
import type { AttemptRecord, ConfirmationRecord, ReceiptRecord, SubmissionExecutionRecord, SubmissionExecutionStore } from './store.js'
import { resolveSubmissionMethod } from './resolver.js'
import { runPreflightValidation } from './validation.js'
import { isConfirmationStillValid } from './confirmation.js'
import { classifyRetrySafety } from './retry.js'
import { classifyReceiptVerification, hasSufficientVerifiedEvidence } from './receipts.js'
import { checkDuplicateSubmission } from './duplicateProtection.js'
import { computeSubmissionIdempotencyKey } from './idempotency.js'
import { resolveSubmissionExecutionStatus } from './stateMachine.js'
import { classifyError } from './errorClassification.js'
import type { AdapterRegistry } from './registry.js'
import type { AdapterExecutionRequest } from './adapters/types.js'

export class SubmissionConflictError extends Error {}
export class SubmissionBlockedError extends Error {
  constructor(
    message: string,
    public readonly blockers: string[],
  ) {
    super(message)
  }
}

function manifestHashOf(files: Array<{ sha256: string; fileName: string }>): string {
  const sorted = [...files].sort((a, b) => a.fileName.localeCompare(b.fileName))
  return createHash('sha256').update(JSON.stringify(sorted.map((f) => ({ fileName: f.fileName, sha256: f.sha256 })))).digest('hex')
}

async function computeCurrentStatus(store: SubmissionExecutionStore, execution: SubmissionExecutionRecord): Promise<SubmissionExecutionRecord['status']> {
  const readiness = await store.getReadinessContext(execution.bidProjectId)
  const approval = await store.getApprovalContext(execution.bidProjectId)
  const pack = await store.getPackContext(execution.bidProjectId)
  const activeConfirmation = await store.getLatestActiveConfirmation(execution.id)
  const activeAttempt = await store.getActiveAttempt(execution.id)
  const attempts = await store.listAttempts(execution.id)
  const receipts = await store.listReceipts(execution.id)
  const lastAttempt = attempts[attempts.length - 1] ?? null

  const packInvalid = !pack.packId || pack.status !== 'CURRENT' || pack.manifestHash !== execution.manifestHash
  const approvalInvalid = approval.status !== 'APPROVED' || approval.packId !== execution.submissionPackId || approval.readinessId !== execution.approvedReadinessId

  const confirmationValid = Boolean(
    activeConfirmation &&
      isConfirmationStillValid({
        confirmationPackId: activeConfirmation.packId,
        confirmationPackVersion: activeConfirmation.packVersion,
        confirmationPackHash: activeConfirmation.packHash,
        confirmationManifestHash: activeConfirmation.manifestHash,
        confirmationReadinessId: activeConfirmation.readinessId,
        currentPackId: pack.packId,
        currentPackVersion: pack.version,
        currentPackHash: execution.submissionPackHash,
        currentManifestHash: pack.manifestHash,
        currentReadinessId: readiness.readinessId,
        confirmationInvalidated: activeConfirmation.invalidated,
      }),
  )

  const verifiedReceiptExists = hasSufficientVerifiedEvidence(receipts.map((r) => r.verificationStatus))
  const humanReported = execution.status === 'SUBMISSION_REPORTED' && !verifiedReceiptExists

  const result = resolveSubmissionExecutionStatus({
    readinessBlocked: readiness.status !== 'READY_TO_SUBMIT' && readiness.status !== 'APPROVED_FOR_SUBMISSION',
    approvalMissingOrInvalid: approvalInvalid,
    packInvalid,
    method: execution.submissionMethod,
    automationStatus: execution.automationStatus,
    confirmationRequired: !confirmationValid && !activeAttempt && !verifiedReceiptExists && !humanReported,
    attemptActive: Boolean(activeAttempt),
    verifiedReceiptExists,
    humanReportedWithoutVerifiedEvidence: humanReported,
    lastAttemptFailedRetrySafe: lastAttempt?.status === 'FAILED' && classifyRetrySafety({ lastAttemptStatus: lastAttempt.status, lastAttemptErrorCode: lastAttempt.errorCode, adapterConfirmedNotReceived: false, explicitHumanConfirmation: false }) !== 'UNSAFE_REQUIRES_VERIFICATION',
    lastAttemptOutcomeUnknown: lastAttempt?.status === 'UNKNOWN_OUTCOME',
    cancelled: execution.status === 'CANCELLED',
    superseded: execution.status === 'SUPERSEDED',
  })
  return result.status
}

/**
 * prepareSubmission — Phase 16 §12/§26 "POST .../submission/prepare".
 * Resolves the submission method against the CURRENT approved pack and
 * readiness snapshot, and persists the execution row. Never itself
 * confirms or attempts anything.
 */
export async function prepareSubmission(
  store: SubmissionExecutionStore,
  params: { bidProjectId: string; agencyId: string; documentEvidenceMethod: string | null; manuallyConfirmedMethod: SubmissionExecutionMethod | null; supportedMethods: readonly SubmissionExecutionMethod[]; nowIso: string; actorId: string },
): Promise<SubmissionExecutionRecord> {
  const bid = await store.getBidContext(params.bidProjectId, params.agencyId)
  if (!bid) throw new Error('Bid project not found for this agency.')

  const readiness = await store.getReadinessContext(params.bidProjectId)
  const pack = await store.getPackContext(params.bidProjectId)
  const approval = await store.getApprovalContext(params.bidProjectId)

  const resolution = resolveSubmissionMethod({
    tenderSubmissionMethod: bid.tenderSubmissionMethod,
    tenderSubmissionUrl: bid.tenderSubmissionUrl,
    tenderSubmissionEmail: bid.tenderSubmissionEmail,
    documentEvidenceMethod: params.documentEvidenceMethod,
    manuallyConfirmedMethod: params.manuallyConfirmedMethod,
    supportedMethods: params.supportedMethods,
  })

  const manifestHash = pack.manifestHash ?? (pack.files.length > 0 ? manifestHashOf(pack.files) : null)
  const existing = await store.getExecution(params.bidProjectId)

  const readinessReady = readiness.status === 'READY_TO_SUBMIT' || readiness.status === 'APPROVED_FOR_SUBMISSION'
  const approvalValid = approval.status === 'APPROVED' && approval.packId === pack.packId && approval.readinessId === readiness.readinessId
  const status = !readinessReady || !approvalValid || !pack.packId ? 'NOT_READY' : resolution.method === 'UNKNOWN' || resolution.automationStatus === 'UNSUPPORTED' ? 'REQUIRES_MANUAL_ACTION' : 'AWAITING_HUMAN_CONFIRMATION'

  const execution = await store.upsertExecution(
    params.bidProjectId,
    params.agencyId,
    bid.tenderId,
    {
      status,
      submissionMethod: resolution.method,
      automationStatus: resolution.automationStatus,
      targetKind: resolution.method === 'EMAIL' ? 'EMAIL' : resolution.method === 'PORTAL' || resolution.method === 'API' ? 'URL' : resolution.method.startsWith('PHYSICAL') ? 'ADDRESS' : null,
      targetValue: resolution.target,
      approvedReadinessId: readiness.readinessId,
      submissionPackId: pack.packId,
      submissionPackVersion: pack.version,
      submissionPackHash: pack.files.length > 0 ? manifestHashOf(pack.files) : null,
      manifestHash,
    },
    existing?.version ?? null,
  )

  await store.writeAuditEvent({ eventType: 'SUBMISSION_PREPARED', agencyId: params.agencyId, actorId: params.actorId, entityId: execution.id, oldValue: null, newValue: { method: resolution.method, automationStatus: resolution.automationStatus, requiresReview: resolution.requiresReview } })
  return execution
}

/**
 * confirmSubmission — Phase 16 §3/§8/§9 "POST .../submission/confirm".
 * The ONLY path that creates a durable, immutable human confirmation.
 * Re-validates the exact current pack/readiness before recording it —
 * a stale confirmation can never be created against a changed package.
 */
export async function confirmSubmission(
  store: SubmissionExecutionStore,
  params: { bidProjectId: string; agencyId: string; statement: string; actorId: string; nowIso: string },
): Promise<ConfirmationRecord> {
  const execution = await store.getExecution(params.bidProjectId)
  if (!execution) throw new Error('No submission preparation exists for this bid; run prepare first.')

  const readiness = await store.getReadinessContext(params.bidProjectId)
  const pack = await store.getPackContext(params.bidProjectId)
  const approval = await store.getApprovalContext(params.bidProjectId)

  if (readiness.status !== 'READY_TO_SUBMIT' && readiness.status !== 'APPROVED_FOR_SUBMISSION') {
    throw new SubmissionBlockedError('Readiness is not current; re-run submission preparation.', ['READINESS_NOT_READY'])
  }
  if (approval.status !== 'APPROVED' || approval.packId !== pack.packId || approval.readinessId !== readiness.readinessId) {
    throw new SubmissionBlockedError('The final approval no longer references the current package; re-approve before confirming.', ['APPROVAL_STALE'])
  }
  if (!pack.packId || pack.status !== 'CURRENT') {
    throw new SubmissionBlockedError('No current submission pack exists.', ['PACK_MISSING'])
  }
  if (execution.status === 'SUBMITTED' || execution.status === 'SUBMISSION_REPORTED') {
    throw new SubmissionBlockedError('This bid already has a recorded submission; an explicit override is required to proceed further.', ['DUPLICATE_SUBMISSION_RISK'])
  }

  const manifestHash = pack.manifestHash ?? manifestHashOf(pack.files)
  const confirmation = await store.createConfirmation({
    submissionExecutionId: execution.id,
    agencyId: params.agencyId,
    readinessId: readiness.readinessId as string,
    packId: pack.packId,
    packVersion: pack.version as number,
    packHash: manifestHash,
    manifestHash,
    submissionMethod: execution.submissionMethod,
    targetValue: execution.targetValue,
    deadlineAt: null,
    statement: params.statement,
    confirmedBy: params.actorId,
  })

  await store.upsertExecution(params.bidProjectId, params.agencyId, execution.tenderId, { status: 'AWAITING_HUMAN_CONFIRMATION', confirmedBy: params.actorId, confirmedAt: confirmation.confirmedAt }, execution.version)
  await store.writeAuditEvent({ eventType: 'SUBMISSION_CONFIRMATION_REQUESTED', agencyId: params.agencyId, actorId: params.actorId, entityId: execution.id, oldValue: null, newValue: null })
  await store.writeAuditEvent({ eventType: 'SUBMISSION_CONFIRMED', agencyId: params.agencyId, actorId: params.actorId, entityId: confirmation.id, oldValue: null, newValue: { packId: pack.packId, packVersion: pack.version, packHash: manifestHash } })
  return confirmation
}

/**
 * attemptSubmission — Phase 16 §10/§13/§14 "POST .../submission/attempt".
 * Re-runs the FULL preflight gate (never trusting a previous check),
 * re-verifies the confirmation is still valid against the exact
 * current pack, then — and only then — calls the adapter.
 */
export async function attemptSubmission(
  store: SubmissionExecutionStore,
  registry: AdapterRegistry,
  params: { bidProjectId: string; agencyId: string; actorId: string; nowIso: string; explicitDuplicateOverride: boolean },
): Promise<AttemptRecord> {
  const execution = await store.getExecution(params.bidProjectId)
  if (!execution) throw new Error('No submission preparation exists for this bid; run prepare first.')

  const bid = await store.getBidContext(params.bidProjectId, params.agencyId)
  if (!bid) throw new Error('Bid project not found for this agency.')
  const readiness = await store.getReadinessContext(params.bidProjectId)
  const pack = await store.getPackContext(params.bidProjectId)
  const approval = await store.getApprovalContext(params.bidProjectId)
  const confirmation = await store.getLatestActiveConfirmation(execution.id)
  const attempts = await store.listAttempts(execution.id)

  const manifestHash = pack.manifestHash ?? (pack.files.length > 0 ? manifestHashOf(pack.files) : null)
  const confirmationValid = Boolean(
    confirmation &&
      isConfirmationStillValid({
        confirmationPackId: confirmation.packId,
        confirmationPackVersion: confirmation.packVersion,
        confirmationPackHash: confirmation.packHash,
        confirmationManifestHash: confirmation.manifestHash,
        confirmationReadinessId: confirmation.readinessId,
        currentPackId: pack.packId,
        currentPackVersion: pack.version,
        currentPackHash: manifestHash,
        currentManifestHash: manifestHash,
        currentReadinessId: readiness.readinessId,
        confirmationInvalidated: confirmation.invalidated,
      }),
  )

  const alreadyConfirmedSubmission = attempts.some((a) => a.status === 'SUCCEEDED')
  const duplicateDecision = checkDuplicateSubmission({ existingConfirmedSubmissionExists: alreadyConfirmedSubmission, samePackVersion: true, sameTarget: true, sameMethod: true, explicitOverride: params.explicitDuplicateOverride })

  const preflight = runPreflightValidation({
    bidExists: true,
    bidBelongsToAgency: true,
    finalBidDecision: bid.finalBidDecision,
    humanOverrideToBid: bid.humanOverrideToBid,
    readinessStatus: readiness.status,
    approvalStatus: approval.status,
    approvalReferencesCurrentPack: approval.packId === pack.packId,
    approvalReferencesCurrentReadiness: approval.readinessId === readiness.readinessId,
    packExists: Boolean(pack.packId),
    packSuperseded: pack.status === 'SUPERSEDED' || pack.status === 'INVALIDATED',
    packHashMatches: true,
    manifestHashMatches: execution.manifestHash === manifestHash,
    requiredFilesPresent: pack.files.length > 0,
    hasMandatoryComplianceBlocker: readiness.blockerCount > 0,
    nowIso: params.nowIso,
    tenderClosingDate: bid.tenderClosingDate,
    tenderClosingTime: bid.tenderClosingTime,
    hasExistingConfirmedSubmission: duplicateDecision === 'ALREADY_RECORDED_BLOCKED',
    explicitDuplicateOverride: params.explicitDuplicateOverride,
  })
  if (!preflight.allowed) {
    throw new SubmissionBlockedError(`Submission blocked: ${preflight.blockers.join(', ')}`, preflight.blockers)
  }
  if (!confirmationValid || !confirmation) {
    throw new SubmissionBlockedError('No valid, current human confirmation exists for this exact package; confirm again.', ['NO_VALID_CONFIRMATION'])
  }

  const idempotencyKey = computeSubmissionIdempotencyKey({ agencyId: params.agencyId, bidProjectId: params.bidProjectId, packVersionId: `${pack.packId}:${pack.version}`, submissionTarget: execution.targetValue, confirmationId: confirmation.id })

  const active = await store.getActiveAttempt(execution.id)
  if (active) throw new SubmissionConflictError('A submission attempt is already in progress for this bid.')

  const attempt = await store.createAttempt({
    submissionExecutionId: execution.id,
    agencyId: params.agencyId,
    attemptNumber: attempts.length + 1,
    method: execution.submissionMethod,
    packId: pack.packId as string,
    packVersion: pack.version as number,
    packHash: manifestHash as string,
    manifestHash: manifestHash as string,
    initiatedBy: params.actorId,
    confirmationId: confirmation.id,
    idempotencyKey,
    startedAt: params.nowIso,
  })
  let currentExecution = await store.upsertExecution(params.bidProjectId, params.agencyId, execution.tenderId, { status: 'SUBMITTING', startedAt: params.nowIso }, execution.version)
  await store.writeAuditEvent({ eventType: 'SUBMISSION_ATTEMPT_STARTED', agencyId: params.agencyId, actorId: params.actorId, entityId: attempt.id, oldValue: null, newValue: { attemptNumber: attempt.attemptNumber, method: attempt.method } })

  const adapter = registry.get(execution.submissionMethod)
  const request: AdapterExecutionRequest = {
    method: execution.submissionMethod,
    target: execution.targetValue,
    packId: pack.packId as string,
    packVersion: pack.version as number,
    packHash: manifestHash as string,
    manifestHash: manifestHash as string,
    files: pack.files.map((f) => ({ fileName: f.fileName, sizeBytes: f.sizeBytes, sha256: f.sha256, mimeType: f.mimeType })),
    confirmationId: confirmation.id,
    idempotencyKey,
  }

  const result = adapter ? await adapter.execute(request) : { outcome: 'REQUIRES_MANUAL_ACTION' as const, providerName: null, providerReference: null, externalSubmissionId: null, responseStatus: null, responseCode: null, errorCode: 'UNSUPPORTED_METHOD' as const, errorMessage: 'No adapter is registered for this submission method.' }

  const terminalStatus = result.outcome === 'SUCCEEDED' ? 'SUCCEEDED' : result.outcome === 'FAILED' ? 'FAILED' : result.outcome === 'UNKNOWN_OUTCOME' ? 'UNKNOWN_OUTCOME' : 'REQUIRES_MANUAL_ACTION'
  const classification = result.errorCode ? classifyError(result.errorCode) : { retryable: false, humanActionRequired: false }

  const completed = await store.completeAttempt(attempt.id, params.agencyId, {
    status: terminalStatus,
    providerName: result.providerName,
    providerReference: result.providerReference,
    externalSubmissionId: result.externalSubmissionId,
    responseStatus: result.responseStatus,
    responseCode: result.responseCode,
    errorCode: result.errorCode,
    errorMessage: result.errorMessage,
    retryable: classification.retryable,
    humanActionRequired: classification.humanActionRequired,
  })

  const executionStatus = terminalStatus === 'SUCCEEDED' ? 'SUBMISSION_REPORTED' : terminalStatus === 'REQUIRES_MANUAL_ACTION' ? 'REQUIRES_MANUAL_ACTION' : terminalStatus === 'UNKNOWN_OUTCOME' ? 'REQUIRES_MANUAL_ACTION' : 'FAILED'
  currentExecution = await store.upsertExecution(
    params.bidProjectId,
    params.agencyId,
    execution.tenderId,
    { status: executionStatus, completedAt: params.nowIso, providerName: result.providerName, providerReference: result.providerReference, externalSubmissionId: result.externalSubmissionId, failureCode: result.errorCode, failureMessage: result.errorMessage, retryable: classification.retryable },
    currentExecution.version,
  )
  await store.writeAuditEvent({ eventType: terminalStatus === 'SUCCEEDED' ? 'SUBMISSION_ATTEMPT_COMPLETED' : 'SUBMISSION_ATTEMPT_FAILED', agencyId: params.agencyId, actorId: params.actorId, entityId: completed.id, oldValue: null, newValue: { status: terminalStatus, errorCode: result.errorCode } })

  if (result.providerReference) {
    await store.createReceipt({
      submissionExecutionId: execution.id,
      attemptId: completed.id,
      agencyId: params.agencyId,
      receiptType: execution.submissionMethod === 'EMAIL' ? 'EMAIL_MESSAGE_ID' : 'PORTAL_RECEIPT',
      providerName: result.providerName,
      providerReference: result.providerReference,
      receiptUrl: null,
      receiptFile: null,
      receiptHash: null,
      issuedAt: params.nowIso,
      capturedBy: null,
      verificationStatus: classifyReceiptVerification({ receiptType: execution.submissionMethod === 'EMAIL' ? 'EMAIL_MESSAGE_ID' : 'PORTAL_RECEIPT', providerIssued: true, corroborated: false, conflictsWithAnotherReceipt: false }),
      notes: 'Automatically captured from the adapter response.',
    })
    await store.writeAuditEvent({ eventType: 'SUBMISSION_RECEIPT_CAPTURED', agencyId: params.agencyId, actorId: params.actorId, entityId: execution.id, oldValue: null, newValue: { providerReference: result.providerReference } })
    if (terminalStatus === 'SUCCEEDED') {
      await store.upsertExecution(params.bidProjectId, params.agencyId, execution.tenderId, { status: 'SUBMITTED' }, currentExecution.version)
    }
  }

  return completed
}

/** recordManualCompletion — Phase 16 §18: a human reports they completed a manual submission. Always SUBMISSION_REPORTED, never SUBMITTED, until independently verified evidence is captured (§18/§62 binding constraint). */
export async function recordManualCompletion(store: SubmissionExecutionStore, params: { bidProjectId: string; agencyId: string; actorId: string; nowIso: string; note: string | null }): Promise<SubmissionExecutionRecord> {
  const execution = await store.getExecution(params.bidProjectId)
  if (!execution) throw new Error('No submission preparation exists for this bid.')
  const updated = await store.upsertExecution(params.bidProjectId, params.agencyId, execution.tenderId, { status: 'SUBMISSION_REPORTED', completedAt: params.nowIso }, execution.version)
  await store.writeAuditEvent({ eventType: 'SUBMISSION_REPORTED', agencyId: params.agencyId, actorId: params.actorId, entityId: execution.id, oldValue: null, newValue: { note: params.note } })
  return updated
}

/** captureReceipt — Phase 16 §19/§20 "POST .../submission/receipts". Never fabricates verification: only a caller-asserted providerIssued/corroborated fact ever yields VERIFIED. */
export async function captureReceipt(
  store: SubmissionExecutionStore,
  params: { bidProjectId: string; agencyId: string; attemptId: string | null; receiptType: ReceiptRecord['receiptType']; providerName: string | null; providerReference: string | null; receiptUrl: string | null; receiptFile: string | null; receiptHash: string | null; issuedAt: string | null; capturedBy: string; providerIssued: boolean; notes: string | null },
): Promise<ReceiptRecord> {
  const execution = await store.getExecution(params.bidProjectId)
  if (!execution) throw new Error('No submission exists for this bid.')
  const existing = await store.listReceipts(execution.id)
  const conflicts = existing.some((r) => r.providerReference && params.providerReference && r.providerReference !== params.providerReference && r.receiptType === params.receiptType)
  const verificationStatus = classifyReceiptVerification({ receiptType: params.receiptType, providerIssued: params.providerIssued, corroborated: existing.length > 0, conflictsWithAnotherReceipt: conflicts })

  const receipt = await store.createReceipt({
    submissionExecutionId: execution.id,
    attemptId: params.attemptId,
    agencyId: params.agencyId,
    receiptType: params.receiptType,
    providerName: params.providerName,
    providerReference: params.providerReference,
    receiptUrl: params.receiptUrl,
    receiptFile: params.receiptFile,
    receiptHash: params.receiptHash,
    issuedAt: params.issuedAt,
    capturedBy: params.capturedBy,
    verificationStatus,
    notes: params.notes,
  })
  await store.writeAuditEvent({ eventType: 'SUBMISSION_RECEIPT_CAPTURED', agencyId: params.agencyId, actorId: params.capturedBy, entityId: receipt.id, oldValue: null, newValue: { receiptType: params.receiptType, verificationStatus } })

  if (verificationStatus === 'VERIFIED') {
    await store.upsertExecution(params.bidProjectId, params.agencyId, execution.tenderId, { status: 'SUBMITTED' }, execution.version)
    await store.writeAuditEvent({ eventType: 'SUBMISSION_RECEIPT_VERIFIED', agencyId: params.agencyId, actorId: params.capturedBy, entityId: receipt.id, oldValue: null, newValue: null })
  }
  return receipt
}

/** cancelSubmission — Phase 16 §5: an explicit terminal state, distinct from any provider-reported outcome. */
export async function cancelSubmission(store: SubmissionExecutionStore, params: { bidProjectId: string; agencyId: string; actorId: string; reason: string }): Promise<SubmissionExecutionRecord> {
  const execution = await store.getExecution(params.bidProjectId)
  if (!execution) throw new Error('No submission exists for this bid.')
  if (execution.status === 'SUBMITTED') throw new SubmissionBlockedError('A verified submission cannot be cancelled.', ['ALREADY_SUBMITTED'])
  const updated = await store.upsertExecution(params.bidProjectId, params.agencyId, execution.tenderId, { status: 'CANCELLED' }, execution.version)
  await store.writeAuditEvent({ eventType: 'SUBMISSION_CANCELLED', agencyId: params.agencyId, actorId: params.actorId, entityId: execution.id, oldValue: null, newValue: { reason: params.reason } })
  return updated
}

export { computeCurrentStatus, manifestHashOf }
