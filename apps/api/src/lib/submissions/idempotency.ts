import { createHash } from 'node:crypto'

/**
 * Phase 16 §50 — LOCAL idempotency key: agency_id + bid_project_id +
 * pack_version_id + submission_target + confirmation_id is sufficient
 * to detect an accidental duplicate execution attempt originating from
 * this system. This is explicitly documented as LOCAL idempotency
 * only (docs/SUBMISSION-EXECUTION.md §"Idempotency") — it can never
 * guarantee the external provider itself treats a resend as a no-op.
 */
export function computeSubmissionIdempotencyKey(params: { agencyId: string; bidProjectId: string; packVersionId: string; submissionTarget: string | null; confirmationId: string }): string {
  const raw = [params.agencyId, params.bidProjectId, params.packVersionId, params.submissionTarget ?? '', params.confirmationId].join('|')
  return createHash('sha256').update(raw).digest('hex')
}
