import type { SubmissionReceiptVerificationStatus } from '@tender-os/constants'
import type { ReceiptVerificationInput } from './types.js'

/**
 * Phase 16 §20 — RECEIPT VERIFICATION. Never fabricates certainty: a
 * captured, provider-issued receipt is VERIFIED; a user-typed
 * reference alone is UNVERIFIED; two receipts disagreeing is
 * CONFLICTING; no receipt at all is MISSING.
 */
export function classifyReceiptVerification(input: ReceiptVerificationInput): SubmissionReceiptVerificationStatus {
  if (input.conflictsWithAnotherReceipt) return 'CONFLICTING'
  if (input.providerIssued) return 'VERIFIED'
  if (input.corroborated) return 'VERIFIED'
  return 'UNVERIFIED'
}

/**
 * Phase 16 §20 — whether the overall submission has SUFFICIENT
 * verified evidence to ever be reported as SUBMITTED (§5/§37/§62
 * binding constraint) rather than merely SUBMISSION_REPORTED.
 */
export function hasSufficientVerifiedEvidence(receiptStatuses: readonly SubmissionReceiptVerificationStatus[]): boolean {
  return receiptStatuses.some((s) => s === 'VERIFIED')
}
