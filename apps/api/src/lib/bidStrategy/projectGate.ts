/**
 * Phase 12 §5/§40/§42 (binding constraint) — pure gate deciding
 * whether a Bid Project may be created for a tender/agency, given the
 * current Phase 11 bid-decision run. Never mutates the Phase 11
 * decision; only reads it.
 */
export interface BidProjectCreationGateInput {
  finalDecision: 'BID' | 'REVIEW' | 'NO_BID' | null
  /** True only when the caller explicitly passed the confirmation flag AND holds an authorized role (checked by the caller before this function runs). */
  authorizedFromReview: boolean
}

export type BidProjectCreationGateResult = { allowed: true } | { allowed: false; httpStatus: 409; reason: string }

export function canCreateBidProject(input: BidProjectCreationGateInput): BidProjectCreationGateResult {
  if (input.finalDecision === 'BID') return { allowed: true }

  if (input.finalDecision === 'REVIEW') {
    if (input.authorizedFromReview) return { allowed: true }
    return {
      allowed: false,
      httpStatus: 409,
      reason: 'This tender\'s final bid decision is REVIEW, not BID. Creating a Bid Project from REVIEW requires explicit authorization (authorizedFromReview=true) by an ADMIN or BID_MANAGER.',
    }
  }

  if (input.finalDecision === 'NO_BID') {
    return {
      allowed: false,
      httpStatus: 409,
      reason: 'This tender\'s final bid decision is NO_BID. A Bid Project cannot be created automatically. If a human has since overridden the decision to BID, re-check the current bid decision and retry.',
    }
  }

  return {
    allowed: false,
    httpStatus: 409,
    reason: 'This tender has no completed bid decision yet. Evaluate the bid decision (Phase 11) before creating a Bid Project.',
  }
}
