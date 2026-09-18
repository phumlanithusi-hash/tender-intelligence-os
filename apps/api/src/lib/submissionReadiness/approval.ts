import type { SubmissionReadinessStatus } from '@tender-os/constants'

/**
 * Phase 15 §37/§38 — PURE approval-safety gate. Never itself performs
 * a write; the route/orchestration layer calls this before issuing
 * `store.createApproval(...)`. Mirrors the same "compute a decision,
 * then act on it" separation as lib/bidStrategy's approval-blocked
 * check in routes/bidStrategy.ts.
 */
export interface ApprovalGateInput {
  readinessStatus: SubmissionReadinessStatus
  blockerCount: number
  approvalReason: string | null | undefined
  actorRole: string
  approveRoles: readonly string[]
}

export interface ApprovalGateResult {
  allowed: boolean
  reasonCode: 'OK' | 'NOT_READY' | 'BLOCKERS_PRESENT' | 'REASON_REQUIRED' | 'ROLE_NOT_AUTHORIZED'
  message: string
}

export function canApproveForSubmission(input: ApprovalGateInput): ApprovalGateResult {
  if (!input.approveRoles.includes(input.actorRole)) {
    return { allowed: false, reasonCode: 'ROLE_NOT_AUTHORIZED', message: 'This role is not authorised to give final submission approval.' }
  }
  if (input.blockerCount > 0 || input.readinessStatus === 'BLOCKED') {
    return { allowed: false, reasonCode: 'BLOCKERS_PRESENT', message: 'Cannot approve for submission while blocking issues remain unresolved.' }
  }
  if (input.readinessStatus !== 'READY_TO_SUBMIT') {
    return { allowed: false, reasonCode: 'NOT_READY', message: `Cannot approve for submission from status ${input.readinessStatus}; only READY_TO_SUBMIT may be approved.` }
  }
  if (!input.approvalReason || input.approvalReason.trim().length === 0) {
    return { allowed: false, reasonCode: 'REASON_REQUIRED', message: 'A non-empty approval reason/confirmation is required.' }
  }
  return { allowed: true, reasonCode: 'OK', message: 'Approval permitted.' }
}
