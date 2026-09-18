import type { StatusResolutionInput, StatusResolutionResult } from './types.js'

/**
 * Phase 16 §37 — the pure, deterministic SUBMISSION STATUS resolver
 * with EXACT precedence, mirroring
 * lib/submissionReadiness/engine.ts's own precedence discipline. No
 * contradictory statuses are ever possible because exactly one branch
 * fires. AI never participates in this decision (§39 binding
 * constraint).
 *
 * Precedence (highest first):
 *   cancelled > superseded > readiness blocked > approval missing/invalid
 *   > pack invalid > method unknown/unsupported > confirmation required
 *   > attempt active > verified receipt exists > human reported without
 *   verified evidence > attempt failed (retry safe) > attempt outcome
 *   unknown > READY_FOR_SUBMISSION.
 */
export function resolveSubmissionExecutionStatus(input: StatusResolutionInput): StatusResolutionResult {
  if (input.cancelled) return { status: 'CANCELLED', reason: 'The submission was cancelled.' }
  if (input.superseded) return { status: 'SUPERSEDED', reason: 'A newer submission package or approval supersedes this one.' }

  if (input.readinessBlocked) return { status: 'NOT_READY', reason: 'Submission readiness reports blocking issues.' }
  if (input.approvalMissingOrInvalid) return { status: 'NOT_READY', reason: 'No valid final approval exists for the current package.' }
  if (input.packInvalid) return { status: 'NOT_READY', reason: 'The submission pack is missing, superseded, or fails integrity checks.' }

  if (input.method === 'UNKNOWN') return { status: 'REQUIRES_MANUAL_ACTION', reason: 'The submission method could not be determined.' }
  if (input.automationStatus === 'UNSUPPORTED') return { status: 'REQUIRES_MANUAL_ACTION', reason: 'This submission method has no supported automation path; a manual workflow is required.' }

  // Exact spec §37 order from here: confirmation required > attempt
  // active > verified receipt > human-reported > failed/retry-safe >
  // outcome-unknown > READY_FOR_SUBMISSION.
  if (input.confirmationRequired) return { status: 'AWAITING_HUMAN_CONFIRMATION', reason: 'The package is ready; explicit human confirmation is required before any attempt.' }
  if (input.attemptActive) return { status: 'SUBMITTING', reason: 'A submission attempt is currently in progress.' }
  if (input.verifiedReceiptExists) return { status: 'SUBMITTED', reason: 'Verified provider/receipt evidence confirms this submission reached the recipient.' }
  if (input.humanReportedWithoutVerifiedEvidence) return { status: 'SUBMISSION_REPORTED', reason: 'A human reported this submission as complete, but no independently-verified evidence has been captured yet.' }
  if (input.lastAttemptFailedRetrySafe) return { status: 'FAILED', reason: 'The last submission attempt failed in a way that is safe to retry.' }
  if (input.lastAttemptOutcomeUnknown) return { status: 'REQUIRES_MANUAL_ACTION', reason: 'The outcome of the last attempt is unknown; verify with the provider before proceeding.' }

  return { status: 'READY_FOR_SUBMISSION', reason: 'The package is ready and awaiting preparation/confirmation.' }
}
