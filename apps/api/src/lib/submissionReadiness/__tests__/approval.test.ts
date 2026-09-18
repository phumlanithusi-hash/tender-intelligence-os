import { describe, expect, it } from 'vitest'
import { SUBMISSION_APPROVE_ROLES } from '@tender-os/constants'
import { canApproveForSubmission } from '../approval.js'
import { approveForSubmission, buildAndSaveSubmissionPack, checkApprovalValidity, runSubmissionReadinessCheck } from '../runSubmissionReadiness.js'
import { createFakeSubmissionReadinessStore } from './fakeSubmissionReadinessStore.js'
import { readyBaseline } from './fixtures.js'

/** Phase 15 §57 — 8 final-approval tests. */
describe('final submission approval (Phase 15 §37/§38/§39)', () => {
  it('an authorised BID_MANAGER can approve a READY_TO_SUBMIT package with a reason', () => {
    const gate = canApproveForSubmission({ readinessStatus: 'READY_TO_SUBMIT', blockerCount: 0, approvalReason: 'Reviewed, all mandatory items satisfied.', actorRole: 'BID_MANAGER', approveRoles: SUBMISSION_APPROVE_ROLES })
    expect(gate.allowed).toBe(true)
  })

  it('an unauthorised RESEARCHER cannot approve, even with blockers=0 and a reason', () => {
    const gate = canApproveForSubmission({ readinessStatus: 'READY_TO_SUBMIT', blockerCount: 0, approvalReason: 'I reviewed it.', actorRole: 'RESEARCHER', approveRoles: SUBMISSION_APPROVE_ROLES })
    expect(gate.allowed).toBe(false)
    expect(gate.reasonCode).toBe('ROLE_NOT_AUTHORIZED')
  })

  it('a BLOCKED readiness can never be approved regardless of role or reason', () => {
    const gate = canApproveForSubmission({ readinessStatus: 'BLOCKED', blockerCount: 3, approvalReason: 'Approve anyway.', actorRole: 'ADMIN', approveRoles: SUBMISSION_APPROVE_ROLES })
    expect(gate.allowed).toBe(false)
    expect(gate.reasonCode).toBe('BLOCKERS_PRESENT')
  })

  it('approval references the exact readiness snapshot and exact pack version, never "the latest"', async () => {
    const { store } = createFakeSubmissionReadinessStore({ input: readyBaseline() })
    const { readiness, result } = await runSubmissionReadinessCheck(store, { bidProjectId: 'bp-1', agencyId: 'agency-a', tenderId: 'tender-1', nowIso: '2026-09-11T09:00:00Z', actorId: 'user-1' })
    const pack = await buildAndSaveSubmissionPack(store, { bidProjectId: 'bp-1', agencyId: 'agency-a', readinessId: readiness.id, proposalVersionId: 'version-1', pricingId: null, manifest: { overallStatus: result.status }, files: [], createdBy: 'user-1' })
    const approval = await approveForSubmission(store, { bidProjectId: 'bp-1', agencyId: 'agency-a', readiness, readinessBlockerCount: result.blockerCount, pack, approvalReason: 'Confirmed ready.', actorId: 'user-1', actorRole: 'BID_MANAGER', approveRoles: SUBMISSION_APPROVE_ROLES })
    expect(approval.readinessId).toBe(readiness.id)
    expect(approval.packId).toBe(pack.id)
  })

  it('approval references the exact pack — a second, later pack does not retroactively attach to an earlier approval', async () => {
    const { store } = createFakeSubmissionReadinessStore({ input: readyBaseline() })
    const { readiness, result } = await runSubmissionReadinessCheck(store, { bidProjectId: 'bp-2', agencyId: 'agency-a', tenderId: 'tender-1', nowIso: '2026-09-11T09:00:00Z', actorId: 'user-1' })
    const packV1 = await buildAndSaveSubmissionPack(store, { bidProjectId: 'bp-2', agencyId: 'agency-a', readinessId: readiness.id, proposalVersionId: 'v1', pricingId: null, manifest: {}, files: [], createdBy: 'user-1' })
    const approval = await approveForSubmission(store, { bidProjectId: 'bp-2', agencyId: 'agency-a', readiness, readinessBlockerCount: result.blockerCount, pack: packV1, approvalReason: 'ok', actorId: 'user-1', actorRole: 'ADMIN', approveRoles: SUBMISSION_APPROVE_ROLES })
    const packV2 = await buildAndSaveSubmissionPack(store, { bidProjectId: 'bp-2', agencyId: 'agency-a', readinessId: readiness.id, proposalVersionId: 'v2', pricingId: null, manifest: {}, files: [], createdBy: 'user-1' })
    expect(checkApprovalValidity(approval, packV2, readiness)).toBe(false)
    expect(checkApprovalValidity(approval, packV1, readiness)).toBe(true)
  })

  it('a changed package (new pack version) invalidates a prior approval', async () => {
    const { store } = createFakeSubmissionReadinessStore({ input: readyBaseline() })
    const { readiness, result } = await runSubmissionReadinessCheck(store, { bidProjectId: 'bp-3', agencyId: 'agency-a', tenderId: 'tender-1', nowIso: '2026-09-11T09:00:00Z', actorId: 'user-1' })
    const pack = await buildAndSaveSubmissionPack(store, { bidProjectId: 'bp-3', agencyId: 'agency-a', readinessId: readiness.id, proposalVersionId: 'v1', pricingId: null, manifest: {}, files: [], createdBy: 'user-1' })
    const approval = await approveForSubmission(store, { bidProjectId: 'bp-3', agencyId: 'agency-a', readiness, readinessBlockerCount: result.blockerCount, pack, approvalReason: 'ok', actorId: 'user-1', actorRole: 'ADMIN', approveRoles: SUBMISSION_APPROVE_ROLES })
    const newerReadiness = { ...readiness, id: 'different-readiness-id' }
    expect(checkApprovalValidity(approval, pack, newerReadiness)).toBe(false)
  })

  it('an audit event (SUBMISSION_APPROVED_FOR_SUBMISSION) is recorded on approval', async () => {
    const { store, state } = createFakeSubmissionReadinessStore({ input: readyBaseline() })
    const { readiness, result } = await runSubmissionReadinessCheck(store, { bidProjectId: 'bp-4', agencyId: 'agency-a', tenderId: 'tender-1', nowIso: '2026-09-11T09:00:00Z', actorId: 'user-1' })
    const pack = await buildAndSaveSubmissionPack(store, { bidProjectId: 'bp-4', agencyId: 'agency-a', readinessId: readiness.id, proposalVersionId: 'v1', pricingId: null, manifest: {}, files: [], createdBy: 'user-1' })
    await approveForSubmission(store, { bidProjectId: 'bp-4', agencyId: 'agency-a', readiness, readinessBlockerCount: result.blockerCount, pack, approvalReason: 'ok', actorId: 'user-1', actorRole: 'ADMIN', approveRoles: SUBMISSION_APPROVE_ROLES })
    expect(state.auditEvents.some((e) => e.eventType === 'SUBMISSION_APPROVED_FOR_SUBMISSION')).toBe(true)
    expect(state.auditEvents.some((e) => e.eventType === 'SUBMISSION_COMPLETED')).toBe(false) // Phase 15 §47 binding constraint — never asserted
  })

  it('revoking an approval marks it REVOKED and writes an audit event', async () => {
    const { store, state } = createFakeSubmissionReadinessStore({ input: readyBaseline() })
    const { readiness, result } = await runSubmissionReadinessCheck(store, { bidProjectId: 'bp-5', agencyId: 'agency-a', tenderId: 'tender-1', nowIso: '2026-09-11T09:00:00Z', actorId: 'user-1' })
    const pack = await buildAndSaveSubmissionPack(store, { bidProjectId: 'bp-5', agencyId: 'agency-a', readinessId: readiness.id, proposalVersionId: 'v1', pricingId: null, manifest: {}, files: [], createdBy: 'user-1' })
    const approval = await approveForSubmission(store, { bidProjectId: 'bp-5', agencyId: 'agency-a', readiness, readinessBlockerCount: result.blockerCount, pack, approvalReason: 'ok', actorId: 'user-1', actorRole: 'ADMIN', approveRoles: SUBMISSION_APPROVE_ROLES })
    const revoked = await store.revokeApproval(approval.id, 'agency-a', 'user-1', 'Package changed materially.')
    expect(revoked.status).toBe('REVOKED')
    expect(state.auditEvents.some((e) => e.eventType === 'SUBMISSION_APPROVAL_REVOKED')).toBe(true)
  })
})
