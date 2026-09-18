import type { EvidenceGapComputationInput, EvidenceGapResult } from './types.js'

/**
 * Phase 13 §E — PURE evidence-gap computation. Reads Phase 12's own
 * `bid_evidence_needs` status vocabulary (OPEN/PARTIALLY_SATISFIED/
 * SATISFIED/BLOCKED/WAIVED) and recommends the status that need
 * SHOULD carry given this phase's approved-claim count — it never
 * forks a parallel evidence-needs model (Phase 13 §E binding
 * constraint). The caller (supabaseEvidenceMatchingStore.ts) is
 * responsible for actually writing this back onto the existing
 * `bid_evidence_needs.status` column; this function only computes the
 * recommendation.
 *
 * A need is never marked SATISFIED by mere candidate generation or
 * semantic score — only a count of real, human-APPROVED claims moves
 * it out of OPEN/PARTIALLY_SATISFIED.
 */
export function computeEvidenceGap(input: EvidenceGapComputationInput): EvidenceGapResult {
  const { need, approvedClaimCount } = input

  // Terminal/human-decided statuses are never overridden by this
  // computation — a WAIVED or BLOCKED need stays exactly as a human
  // (or an earlier explicit rule) left it.
  if (need.currentStatus === 'WAIVED' || need.currentStatus === 'BLOCKED') {
    return { evidenceNeedId: need.id, recommendedStatus: need.currentStatus, isGap: need.currentStatus === 'BLOCKED', reason: `Status is ${need.currentStatus} and is not recomputed automatically.` }
  }

  if (approvedClaimCount >= need.minimumCount) {
    return { evidenceNeedId: need.id, recommendedStatus: 'SATISFIED', isGap: false, reason: `${approvedClaimCount} of ${need.minimumCount} required evidence claim(s) approved.` }
  }

  if (approvedClaimCount > 0) {
    return {
      evidenceNeedId: need.id,
      recommendedStatus: 'PARTIALLY_SATISFIED',
      isGap: true,
      reason: `Only ${approvedClaimCount} of ${need.minimumCount} required evidence claim(s) approved — a gap remains.`,
    }
  }

  if (input.hasOnlyRejectedOrNoCandidates) {
    return {
      evidenceNeedId: need.id,
      recommendedStatus: 'OPEN',
      isGap: true,
      reason: 'No approved evidence claim exists; every candidate so far has either been rejected or none was found.',
    }
  }

  return { evidenceNeedId: need.id, recommendedStatus: 'OPEN', isGap: true, reason: 'No approved evidence claim exists yet.' }
}

export function computeEvidenceGaps(inputs: EvidenceGapComputationInput[]): EvidenceGapResult[] {
  return inputs.map(computeEvidenceGap)
}
