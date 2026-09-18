import { describe, expect, it } from 'vitest'
import { createFakeSubmissionExecutionStore, makeDefaultState } from './fakeSubmissionExecutionStore.js'
import { attemptSubmission, confirmSubmission, prepareSubmission, recordManualCompletion, captureReceipt, cancelSubmission, SubmissionBlockedError, SubmissionConflictError } from '../runSubmission.js'
import { buildDefaultAdapterRegistry } from '../registry.js'
import type { AdapterRegistry } from '../registry.js'
import { MockPortalSuccessAdapter, MockPortalTimeoutAdapter, MockPortalCaptchaAdapter, MockPortalRejectedAdapter } from '../adapters/mock/mockAdapters.js'

const NOW = '2026-09-12T00:00:00Z'

function mockRegistry(adapter: typeof MockPortalSuccessAdapter): AdapterRegistry {
  return { supportedMethods: ['PORTAL', 'EMAIL', 'PHYSICAL_COURIER', 'PHYSICAL_HAND_DELIVERY', 'API', 'OTHER'], get: () => adapter }
}

describe('runSubmission orchestration (Phase 16 full workflow §64)', () => {
  it('prepare -> confirm -> attempt -> provider success -> receipt -> SUBMITTED', async () => {
    const state = makeDefaultState()
    const store = createFakeSubmissionExecutionStore(state)

    const prepared = await prepareSubmission(store, { bidProjectId: 'bid-1', agencyId: 'agency-1', documentEvidenceMethod: null, manuallyConfirmedMethod: null, supportedMethods: ['PORTAL', 'EMAIL'], nowIso: NOW, actorId: 'user-1' })
    expect(prepared.status).toBe('AWAITING_HUMAN_CONFIRMATION')
    expect(prepared.submissionMethod).toBe('PORTAL')

    const confirmation = await confirmSubmission(store, { bidProjectId: 'bid-1', agencyId: 'agency-1', statement: 'I confirm that I am authorised to submit this bid using the exact approved submission pack.', actorId: 'user-1', nowIso: NOW })
    expect(confirmation.packId).toBe('pack-1')

    const attempt = await attemptSubmission(store, mockRegistry(MockPortalSuccessAdapter), { bidProjectId: 'bid-1', agencyId: 'agency-1', actorId: 'user-1', nowIso: NOW, explicitDuplicateOverride: false })
    expect(attempt.status).toBe('SUCCEEDED')
    expect(attempt.providerReference).toBeTruthy()

    const execution = await store.getExecution('bid-1')
    expect(execution?.status).toBe('SUBMITTED')
    expect(state.receipts.length).toBe(1)
    expect(state.receipts[0]!.verificationStatus).toBe('VERIFIED')
  })

  it('a provider CAPTCHA response requires manual action, never bypassed', async () => {
    const state = makeDefaultState()
    const store = createFakeSubmissionExecutionStore(state)
    await prepareSubmission(store, { bidProjectId: 'bid-1', agencyId: 'agency-1', documentEvidenceMethod: null, manuallyConfirmedMethod: null, supportedMethods: ['PORTAL'], nowIso: NOW, actorId: 'user-1' })
    await confirmSubmission(store, { bidProjectId: 'bid-1', agencyId: 'agency-1', statement: 'confirmed', actorId: 'user-1', nowIso: NOW })
    const attempt = await attemptSubmission(store, mockRegistry(MockPortalCaptchaAdapter), { bidProjectId: 'bid-1', agencyId: 'agency-1', actorId: 'user-1', nowIso: NOW, explicitDuplicateOverride: false })
    expect(attempt.status).toBe('REQUIRES_MANUAL_ACTION')
    expect(attempt.errorCode).toBe('CAPTCHA_REQUIRED')
    const execution = await store.getExecution('bid-1')
    expect(execution?.status).toBe('REQUIRES_MANUAL_ACTION')
    expect(execution?.status).not.toBe('SUBMITTED')
  })

  it('a provider rejection never becomes SUBMITTED', async () => {
    const state = makeDefaultState()
    const store = createFakeSubmissionExecutionStore(state)
    await prepareSubmission(store, { bidProjectId: 'bid-1', agencyId: 'agency-1', documentEvidenceMethod: null, manuallyConfirmedMethod: null, supportedMethods: ['PORTAL'], nowIso: NOW, actorId: 'user-1' })
    await confirmSubmission(store, { bidProjectId: 'bid-1', agencyId: 'agency-1', statement: 'confirmed', actorId: 'user-1', nowIso: NOW })
    const attempt = await attemptSubmission(store, mockRegistry(MockPortalRejectedAdapter), { bidProjectId: 'bid-1', agencyId: 'agency-1', actorId: 'user-1', nowIso: NOW, explicitDuplicateOverride: false })
    expect(attempt.status).toBe('FAILED')
    const execution = await store.getExecution('bid-1')
    expect(execution?.status).toBe('FAILED')
  })

  it('an unknown provider outcome (timeout) never becomes SUBMITTED or FAILED — REQUIRES_MANUAL_ACTION until verified', async () => {
    const state = makeDefaultState()
    const store = createFakeSubmissionExecutionStore(state)
    await prepareSubmission(store, { bidProjectId: 'bid-1', agencyId: 'agency-1', documentEvidenceMethod: null, manuallyConfirmedMethod: null, supportedMethods: ['PORTAL'], nowIso: NOW, actorId: 'user-1' })
    await confirmSubmission(store, { bidProjectId: 'bid-1', agencyId: 'agency-1', statement: 'confirmed', actorId: 'user-1', nowIso: NOW })
    const attempt = await attemptSubmission(store, mockRegistry(MockPortalTimeoutAdapter), { bidProjectId: 'bid-1', agencyId: 'agency-1', actorId: 'user-1', nowIso: NOW, explicitDuplicateOverride: false })
    expect(attempt.status).toBe('UNKNOWN_OUTCOME')
    const execution = await store.getExecution('bid-1')
    expect(execution?.status).toBe('REQUIRES_MANUAL_ACTION')
  })

  it('deadline passed blocks the attempt', async () => {
    const state = makeDefaultState({ bid: { ...makeDefaultState().bid, tenderClosingDate: '2026-01-01', tenderClosingTime: '00:00:00' } })
    const store = createFakeSubmissionExecutionStore(state)
    await prepareSubmission(store, { bidProjectId: 'bid-1', agencyId: 'agency-1', documentEvidenceMethod: null, manuallyConfirmedMethod: null, supportedMethods: ['PORTAL'], nowIso: NOW, actorId: 'user-1' })
    await confirmSubmission(store, { bidProjectId: 'bid-1', agencyId: 'agency-1', statement: 'confirmed', actorId: 'user-1', nowIso: NOW })
    await expect(attemptSubmission(store, mockRegistry(MockPortalSuccessAdapter), { bidProjectId: 'bid-1', agencyId: 'agency-1', actorId: 'user-1', nowIso: NOW, explicitDuplicateOverride: false })).rejects.toThrow(SubmissionBlockedError)
  })

  it('a changed pack after confirmation blocks the attempt (approval invalidated / no valid confirmation)', async () => {
    const state = makeDefaultState()
    const store = createFakeSubmissionExecutionStore(state)
    await prepareSubmission(store, { bidProjectId: 'bid-1', agencyId: 'agency-1', documentEvidenceMethod: null, manuallyConfirmedMethod: null, supportedMethods: ['PORTAL'], nowIso: NOW, actorId: 'user-1' })
    await confirmSubmission(store, { bidProjectId: 'bid-1', agencyId: 'agency-1', statement: 'confirmed', actorId: 'user-1', nowIso: NOW })

    // Simulate the user editing pricing and a new pack v2 being built.
    state.pack = { packId: 'pack-2', version: 2, status: 'CURRENT', manifestHash: 'manifest-hash-2', files: state.pack.files }
    state.approval = { approvalId: 'approval-2', status: 'APPROVED', packId: 'pack-2', readinessId: 'readiness-1' }

    await expect(attemptSubmission(store, mockRegistry(MockPortalSuccessAdapter), { bidProjectId: 'bid-1', agencyId: 'agency-1', actorId: 'user-1', nowIso: NOW, explicitDuplicateOverride: false })).rejects.toThrow()
  })

  it('missing receipt: no attempt yet has no verified evidence, execution stays not-submitted', async () => {
    const state = makeDefaultState()
    const store = createFakeSubmissionExecutionStore(state)
    await prepareSubmission(store, { bidProjectId: 'bid-1', agencyId: 'agency-1', documentEvidenceMethod: null, manuallyConfirmedMethod: null, supportedMethods: ['PORTAL'], nowIso: NOW, actorId: 'user-1' })
    const execution = await store.getExecution('bid-1')
    expect(execution?.status).not.toBe('SUBMITTED')
  })

  it('duplicate attempt: a second attempt after a confirmed submission is blocked without explicit override', async () => {
    const state = makeDefaultState()
    const store = createFakeSubmissionExecutionStore(state)
    await prepareSubmission(store, { bidProjectId: 'bid-1', agencyId: 'agency-1', documentEvidenceMethod: null, manuallyConfirmedMethod: null, supportedMethods: ['PORTAL'], nowIso: NOW, actorId: 'user-1' })
    await confirmSubmission(store, { bidProjectId: 'bid-1', agencyId: 'agency-1', statement: 'confirmed', actorId: 'user-1', nowIso: NOW })
    await attemptSubmission(store, mockRegistry(MockPortalSuccessAdapter), { bidProjectId: 'bid-1', agencyId: 'agency-1', actorId: 'user-1', nowIso: NOW, explicitDuplicateOverride: false })

    await expect(confirmSubmission(store, { bidProjectId: 'bid-1', agencyId: 'agency-1', statement: 'confirmed again', actorId: 'user-1', nowIso: NOW })).rejects.toThrow(SubmissionBlockedError)
  })

  it('concurrent attempts are blocked: a second in-flight attempt on the same execution conflicts', async () => {
    const state = makeDefaultState()
    const store = createFakeSubmissionExecutionStore(state)
    await prepareSubmission(store, { bidProjectId: 'bid-1', agencyId: 'agency-1', documentEvidenceMethod: null, manuallyConfirmedMethod: null, supportedMethods: ['PORTAL'], nowIso: NOW, actorId: 'user-1' })
    await confirmSubmission(store, { bidProjectId: 'bid-1', agencyId: 'agency-1', statement: 'confirmed', actorId: 'user-1', nowIso: NOW })
    const execution = await store.getExecution('bid-1')
    state.attempts.push({ id: 'in-flight', submissionExecutionId: execution!.id, agencyId: 'agency-1', attemptNumber: 1, status: 'STARTED', method: 'PORTAL', packId: 'pack-1', packVersion: 1, packHash: 'x', manifestHash: 'x', initiatedBy: 'user-1', confirmationId: 'x', idempotencyKey: 'x', startedAt: NOW, completedAt: null, providerName: null, providerReference: null, externalSubmissionId: null, responseStatus: null, responseCode: null, errorCode: null, errorMessage: null, retryable: null, humanActionRequired: false })

    await expect(attemptSubmission(store, mockRegistry(MockPortalSuccessAdapter), { bidProjectId: 'bid-1', agencyId: 'agency-1', actorId: 'user-1', nowIso: NOW, explicitDuplicateOverride: false })).rejects.toThrow(SubmissionConflictError)
  })

  it('manual completion produces SUBMISSION_REPORTED, never SUBMITTED', async () => {
    const state = makeDefaultState()
    const store = createFakeSubmissionExecutionStore(state)
    await prepareSubmission(store, { bidProjectId: 'bid-1', agencyId: 'agency-1', documentEvidenceMethod: null, manuallyConfirmedMethod: null, supportedMethods: ['PORTAL'], nowIso: NOW, actorId: 'user-1' })
    const updated = await recordManualCompletion(store, { bidProjectId: 'bid-1', agencyId: 'agency-1', actorId: 'user-1', nowIso: NOW, note: 'Uploaded manually via the portal.' })
    expect(updated.status).toBe('SUBMISSION_REPORTED')
    expect(updated.status).not.toBe('SUBMITTED')
  })

  it('capturing a provider-issued receipt after a manual report upgrades the execution to SUBMITTED', async () => {
    const state = makeDefaultState()
    const store = createFakeSubmissionExecutionStore(state)
    await prepareSubmission(store, { bidProjectId: 'bid-1', agencyId: 'agency-1', documentEvidenceMethod: null, manuallyConfirmedMethod: null, supportedMethods: ['PORTAL'], nowIso: NOW, actorId: 'user-1' })
    await recordManualCompletion(store, { bidProjectId: 'bid-1', agencyId: 'agency-1', actorId: 'user-1', nowIso: NOW, note: 'done' })
    const receipt = await captureReceipt(store, { bidProjectId: 'bid-1', agencyId: 'agency-1', attemptId: null, receiptType: 'PORTAL_RECEIPT', providerName: 'PORTAL', providerReference: 'REF-999', receiptUrl: null, receiptFile: null, receiptHash: null, issuedAt: NOW, capturedBy: 'user-1', providerIssued: true, notes: null })
    expect(receipt.verificationStatus).toBe('VERIFIED')
    const execution = await store.getExecution('bid-1')
    expect(execution?.status).toBe('SUBMITTED')
  })

  it('a user-entered reference alone stays UNVERIFIED and does not upgrade to SUBMITTED', async () => {
    const state = makeDefaultState()
    const store = createFakeSubmissionExecutionStore(state)
    await prepareSubmission(store, { bidProjectId: 'bid-1', agencyId: 'agency-1', documentEvidenceMethod: null, manuallyConfirmedMethod: null, supportedMethods: ['PORTAL'], nowIso: NOW, actorId: 'user-1' })
    await recordManualCompletion(store, { bidProjectId: 'bid-1', agencyId: 'agency-1', actorId: 'user-1', nowIso: NOW, note: 'done' })
    const receipt = await captureReceipt(store, { bidProjectId: 'bid-1', agencyId: 'agency-1', attemptId: null, receiptType: 'MANUAL_ATTESTATION', providerName: null, providerReference: 'user-typed-ref', receiptUrl: null, receiptFile: null, receiptHash: null, issuedAt: NOW, capturedBy: 'user-1', providerIssued: false, notes: null })
    expect(receipt.verificationStatus).toBe('UNVERIFIED')
    const execution = await store.getExecution('bid-1')
    expect(execution?.status).toBe('SUBMISSION_REPORTED')
  })

  it('cancelling an already-verified submission is blocked', async () => {
    const state = makeDefaultState()
    const store = createFakeSubmissionExecutionStore(state)
    await prepareSubmission(store, { bidProjectId: 'bid-1', agencyId: 'agency-1', documentEvidenceMethod: null, manuallyConfirmedMethod: null, supportedMethods: ['PORTAL'], nowIso: NOW, actorId: 'user-1' })
    await confirmSubmission(store, { bidProjectId: 'bid-1', agencyId: 'agency-1', statement: 'confirmed', actorId: 'user-1', nowIso: NOW })
    await attemptSubmission(store, mockRegistry(MockPortalSuccessAdapter), { bidProjectId: 'bid-1', agencyId: 'agency-1', actorId: 'user-1', nowIso: NOW, explicitDuplicateOverride: false })
    await expect(cancelSubmission(store, { bidProjectId: 'bid-1', agencyId: 'agency-1', actorId: 'user-1', reason: 'changed mind' })).rejects.toThrow(SubmissionBlockedError)
  })

  it('cancelling a not-yet-attempted submission succeeds', async () => {
    const state = makeDefaultState()
    const store = createFakeSubmissionExecutionStore(state)
    await prepareSubmission(store, { bidProjectId: 'bid-1', agencyId: 'agency-1', documentEvidenceMethod: null, manuallyConfirmedMethod: null, supportedMethods: ['PORTAL'], nowIso: NOW, actorId: 'user-1' })
    const cancelled = await cancelSubmission(store, { bidProjectId: 'bid-1', agencyId: 'agency-1', actorId: 'user-1', reason: 'tender withdrawn' })
    expect(cancelled.status).toBe('CANCELLED')
  })

  it('an unknown/unsupported method routes to REQUIRES_MANUAL_ACTION at prepare time', async () => {
    const state = makeDefaultState({ bid: { ...makeDefaultState().bid, tenderSubmissionMethod: null, tenderSubmissionUrl: null } })
    const store = createFakeSubmissionExecutionStore(state)
    const prepared = await prepareSubmission(store, { bidProjectId: 'bid-1', agencyId: 'agency-1', documentEvidenceMethod: null, manuallyConfirmedMethod: null, supportedMethods: ['PORTAL'], nowIso: NOW, actorId: 'user-1' })
    expect(prepared.status).toBe('REQUIRES_MANUAL_ACTION')
    expect(prepared.submissionMethod).toBe('UNKNOWN')
  })

  it('a readiness that is not READY_TO_SUBMIT keeps the execution NOT_READY', async () => {
    const state = makeDefaultState({ readiness: { readinessId: 'readiness-1', status: 'BLOCKED', blockerCount: 1 } })
    const store = createFakeSubmissionExecutionStore(state)
    const prepared = await prepareSubmission(store, { bidProjectId: 'bid-1', agencyId: 'agency-1', documentEvidenceMethod: null, manuallyConfirmedMethod: null, supportedMethods: ['PORTAL'], nowIso: NOW, actorId: 'user-1' })
    expect(prepared.status).toBe('NOT_READY')
  })

  it('a real adapter registry (no automation configured) degrades to manual, never fabricating a live submission', async () => {
    const state = makeDefaultState()
    const store = createFakeSubmissionExecutionStore(state)
    await prepareSubmission(store, { bidProjectId: 'bid-1', agencyId: 'agency-1', documentEvidenceMethod: null, manuallyConfirmedMethod: null, supportedMethods: ['PORTAL', 'EMAIL', 'API', 'PHYSICAL_COURIER', 'PHYSICAL_HAND_DELIVERY', 'OTHER'], nowIso: NOW, actorId: 'user-1' })
    await confirmSubmission(store, { bidProjectId: 'bid-1', agencyId: 'agency-1', statement: 'confirmed', actorId: 'user-1', nowIso: NOW })
    const registry = buildDefaultAdapterRegistry({ emailManifestFiles: [], emailOutgoingFiles: [], emailSubject: 'x', emailBody: 'x', emailSender: null, portalAutomation: null, portalAllowedHosts: ['etenders.gov.za'], apiClient: null, apiAllowedHosts: [], physicalDeliveryAddress: null })
    const attempt = await attemptSubmission(store, registry, { bidProjectId: 'bid-1', agencyId: 'agency-1', actorId: 'user-1', nowIso: NOW, explicitDuplicateOverride: false })
    expect(attempt.status).toBe('REQUIRES_MANUAL_ACTION')
  })
})
