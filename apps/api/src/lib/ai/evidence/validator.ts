import type { EvidenceResolutionResult } from './resolver.js'

export interface EvidenceGatedTruth {
  truth: string
  evidenceResolved: boolean
  requiresReview: boolean
  note: string | null
}

/**
 * Enforces Phase 7 §16/§18: a FACT or INFERENCE truth state must be
 * backed by at least one server-resolved evidence item; confidence is
 * never a substitute for evidence, and a confident but unverifiable
 * claim is downgraded, never trusted at face value. UNKNOWN claims
 * never require evidence. A claim that requested evidence but got
 * none resolved flags `requiresReview: true` so the run is marked
 * REQUIRES_REVIEW/PARTIAL rather than silently COMPLETED (Phase 7 §21).
 */
export function gateTruthByEvidence(claimedTruth: string, evidence: EvidenceResolutionResult): EvidenceGatedTruth {
  if (claimedTruth === 'UNKNOWN') {
    return { truth: 'UNKNOWN', evidenceResolved: false, requiresReview: false, note: null }
  }

  if (evidence.resolved.length > 0) {
    return { truth: claimedTruth, evidenceResolved: true, requiresReview: false, note: null }
  }

  // Claimed FACT/INFERENCE/UNVERIFIED but no evidence resolved.
  const requestedButFailed = evidence.anyRequested
  return {
    truth: 'UNVERIFIED',
    evidenceResolved: false,
    requiresReview: true,
    note: requestedButFailed
      ? `Model cited evidence that could not be verified: ${evidence.rejectedReasons.join('; ')}`
      : 'Model made a non-UNKNOWN claim without citing any evidence.',
  }
}
