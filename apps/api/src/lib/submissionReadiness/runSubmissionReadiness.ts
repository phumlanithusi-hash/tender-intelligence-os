import { calculateSubmissionReadiness } from './engine.js'
import type { SubmissionReadinessResult } from './types.js'
import type { ApprovalRecord, PackRecord, ReadinessRecord, SubmissionReadinessStore } from './store.js'
import { canApproveForSubmission } from './approval.js'
import { isApprovalStillValid } from './staleness.js'

/**
 * runSubmissionReadinessCheck — the Phase 15 orchestration seam
 * (mirrors lib/bidDecision/runBidDecision.ts exactly): assembles real
 * data through the store port, runs the PURE deterministic engine,
 * then persists an immutable snapshot + its items + an audit event.
 * Never itself decides READY_TO_SUBMIT/BLOCKED — that is entirely
 * `calculateSubmissionReadiness`'s job (Phase 15 §8 binding
 * constraint); this function only wires I/O around it.
 */
export async function runSubmissionReadinessCheck(
  store: SubmissionReadinessStore,
  params: { bidProjectId: string; agencyId: string; tenderId: string; nowIso: string; actorId: string | null },
): Promise<{ readiness: ReadinessRecord; result: SubmissionReadinessResult }> {
  const { input, snapshot } = await store.assembleInput(params.bidProjectId, params.agencyId, params.nowIso)
  const result = calculateSubmissionReadiness(input)

  const readiness = await store.createReadinessSnapshot({
    bidProjectId: params.bidProjectId,
    agencyId: params.agencyId,
    tenderId: params.tenderId,
    result,
    proposalVersionId: input.proposal.versionId,
    pricingId: null, // resolved by the store from the assembled snapshot when pricing exists
    snapshot,
    computedBy: params.actorId,
  })

  await store.writeAuditEvent({
    eventType: 'SUBMISSION_READINESS_CALCULATED',
    agencyId: params.agencyId,
    actorId: params.actorId,
    entityId: readiness.id,
    oldValue: null,
    newValue: { status: result.status, blockerCount: result.blockerCount, warningCount: result.warningCount },
  })
  await store.writeAuditEvent({
    eventType: 'FINAL_COMPLIANCE_RUN',
    agencyId: params.agencyId,
    actorId: params.actorId,
    entityId: readiness.id,
    oldValue: null,
    newValue: { bidProjectId: params.bidProjectId, tenderId: params.tenderId },
  })

  return { readiness, result }
}

/**
 * buildAndSaveSubmissionPack — Phase 15 §33/§34: assembles a new,
 * versioned pack from the CURRENT readiness snapshot + already-built
 * file records. Never reuses/overwrites a prior pack (the store
 * enforces versioning + one-CURRENT-per-project at the DB level).
 */
export async function buildAndSaveSubmissionPack(
  store: SubmissionReadinessStore,
  params: {
    bidProjectId: string
    agencyId: string
    readinessId: string
    proposalVersionId: string | null
    pricingId: string | null
    manifest: Record<string, unknown>
    files: Array<{ documentType: string; fileName: string; storagePath: string | null; mimeType: string | null; sizeBytes: number | null; sha256: string; sourceTable: string | null; sourceId: string | null }>
    createdBy: string | null
  },
): Promise<PackRecord> {
  const pack = await store.createPack(params)
  await store.writeAuditEvent({ eventType: 'SUBMISSION_PACK_CREATED', agencyId: params.agencyId, actorId: params.createdBy, entityId: pack.id, oldValue: null, newValue: { version: pack.version } })
  if (pack.version > 1) {
    await store.writeAuditEvent({ eventType: 'SUBMISSION_PACK_VERSION_CREATED', agencyId: params.agencyId, actorId: params.createdBy, entityId: pack.id, oldValue: null, newValue: { version: pack.version } })
  }
  await store.writeAuditEvent({ eventType: 'SUBMISSION_MANIFEST_CREATED', agencyId: params.agencyId, actorId: params.createdBy, entityId: pack.id, oldValue: null, newValue: null })
  return pack
}

/**
 * approveForSubmission — Phase 15 §37/§38/§39: the ONLY path to
 * APPROVED_FOR_SUBMISSION. Refuses when blockers remain, the
 * readiness isn't READY_TO_SUBMIT, the actor lacks the role, or no
 * reason was given (canApproveForSubmission is the single source of
 * truth for this gate). Never performs any actual submission
 * (§39/§63 binding constraint) — the caller displays "READY FOR HUMAN
 * SUBMISSION" / "APPROVED FOR HUMAN SUBMISSION" only.
 */
export async function approveForSubmission(
  store: SubmissionReadinessStore,
  params: { bidProjectId: string; agencyId: string; readiness: ReadinessRecord; readinessBlockerCount: number; pack: PackRecord; approvalReason: string; actorId: string; actorRole: string; approveRoles: readonly string[] },
): Promise<ApprovalRecord> {
  const gate = canApproveForSubmission({ readinessStatus: params.readiness.status, blockerCount: params.readinessBlockerCount, approvalReason: params.approvalReason, actorRole: params.actorRole, approveRoles: params.approveRoles })
  if (!gate.allowed) throw new Error(gate.message)

  const approval = await store.createApproval({ bidProjectId: params.bidProjectId, agencyId: params.agencyId, readinessId: params.readiness.id, packId: params.pack.id, approvalReason: params.approvalReason, approvedBy: params.actorId })
  await store.writeAuditEvent({ eventType: 'SUBMISSION_APPROVED_FOR_SUBMISSION', agencyId: params.agencyId, actorId: params.actorId, entityId: approval.id, oldValue: null, newValue: { packId: params.pack.id, readinessId: params.readiness.id } })
  return approval
}

/**
 * checkApprovalValidity — Phase 15 §37/§38/§48: an approval is only
 * ever valid while it still references the exact CURRENT pack and
 * readiness snapshot for this bid project. Call this whenever the
 * package might have changed (a new readiness check, a new pack) —
 * never assume a past approval still holds.
 */
export function checkApprovalValidity(approval: ApprovalRecord, currentPack: PackRecord | null, currentReadiness: ReadinessRecord | null): boolean {
  return isApprovalStillValid({ approvalPackId: approval.packId, currentPackId: currentPack?.id ?? null, approvalReadinessId: approval.readinessId, currentReadinessId: currentReadiness?.id ?? null })
}
