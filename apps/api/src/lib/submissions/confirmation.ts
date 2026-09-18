import type { ConfirmationValidityInput } from './types.js'

/**
 * Phase 16 §8/§9 — a human confirmation is only ever valid while it
 * still references the EXACT current pack (id + version + hash),
 * manifest hash, and readiness snapshot. Any drift means the approval
 * behind it — and the confirmation itself — must be treated as
 * invalid: "a stale confirmation must never authorise a changed
 * package" (§8 binding constraint). Mirrors
 * lib/submissionReadiness/staleness.ts's isApprovalStillValid exactly,
 * extended with the pack version/hash/manifest-hash triad Phase 16
 * additionally requires before every attempt.
 */
export function isConfirmationStillValid(input: ConfirmationValidityInput): boolean {
  if (input.confirmationInvalidated) return false
  return (
    input.confirmationPackId === input.currentPackId &&
    input.confirmationPackVersion === input.currentPackVersion &&
    input.confirmationPackHash === input.currentPackHash &&
    input.confirmationManifestHash === input.currentManifestHash &&
    input.confirmationReadinessId === input.currentReadinessId
  )
}
