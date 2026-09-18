import { isSnapshotStale } from '../scoring/staleness.js'

/**
 * Phase 15 §36/§48 — a submission readiness snapshot (and any pack
 * built from it) becomes invalid when any material dependency changes:
 * tender addendum, requirement change, evaluation change, proposal
 * change, pricing change, required document change, certificate
 * expiry, evidence becoming stale, submission instruction change,
 * deadline change, file replacement. Reuses the exact same
 * snapshot-comparison mechanism every prior phase uses (Phase 10 §46,
 * re-exported through scoring -> ... -> proposals -> here) rather than
 * inventing a sixth staleness algorithm.
 */
export { isSnapshotStale }

export interface SubmissionApprovalValidityInput {
  approvalPackId: string
  currentPackId: string | null
  approvalReadinessId: string
  currentReadinessId: string | null
}

/**
 * isApprovalStillValid: an APPROVED_FOR_SUBMISSION approval is only
 * ever valid while it still references the exact current pack and
 * readiness snapshot (Phase 15 §37/§38 binding constraint — "must not
 * leave approval valid against a changed package"). Any drift means
 * the approval must be treated as SUPERSEDED/REQUIRES_REVIEW.
 */
export function isApprovalStillValid(input: SubmissionApprovalValidityInput): boolean {
  return input.approvalPackId === input.currentPackId && input.approvalReadinessId === input.currentReadinessId
}
