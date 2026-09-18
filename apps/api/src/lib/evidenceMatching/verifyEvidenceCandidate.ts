import type { VerificationCandidateInput, VerificationCheck, VerificationEvidenceNeedInput, VerificationResult, VerificationRules } from './types.js'

/**
 * Phase 13 §C — PURE, deterministic verification. Applies rule-based
 * structural checks to a candidate independently of, and never
 * overridden by, its semantic similarity score (which lives entirely
 * in rankEvidenceCandidates.ts and is never read here). This function
 * NEVER returns 'APPROVED' or 'REJECTED' — those are exclusively
 * human-actioned end states applied by the store/route layer after a
 * real human decision (Phase 13 §C/§D binding constraint: "a strong
 * deterministic + semantic match still requires human action").
 *
 * A truth state of UNKNOWN is never silently promoted to a positive
 * determination by this function — an UNKNOWN `evidenceStatus`
 * produces REQUIRES_VERIFICATION at best, never VERIFIED.
 */
export function verifyEvidenceCandidate(candidate: VerificationCandidateInput, evidenceNeed: VerificationEvidenceNeedInput, rules: VerificationRules): VerificationResult {
  const checks: VerificationCheck[] = []

  const agencyMatches = candidate.candidateAgencyId === evidenceNeed.requiredAgencyId
  checks.push({
    code: 'AGENCY_MATCH',
    passed: agencyMatches,
    message: agencyMatches ? 'Candidate evidence belongs to the requesting agency.' : 'Candidate evidence does not belong to the requesting agency — rejected at the validation layer, never trusted.',
  })

  const typeEligible = !evidenceNeed.allowedEntityTypes || evidenceNeed.allowedEntityTypes.length === 0 || evidenceNeed.allowedEntityTypes.includes(candidate.entityType)
  checks.push({
    code: 'TYPE_ELIGIBLE',
    passed: typeEligible,
    message: typeEligible ? 'Evidence type is eligible for this evidence need.' : `Evidence type ${candidate.entityType} is not one of the types this evidence need allows.`,
  })

  checks.push({
    code: 'SOURCE_ACTIVE',
    passed: candidate.sourceActive,
    message: candidate.sourceActive ? 'The underlying evidence source is active (not superseded).' : 'The underlying evidence source has been superseded or deactivated.',
  })

  const notExpired = isNotExpired(candidate.expiryDate, rules.nowIso)
  checks.push({
    code: 'NOT_EXPIRED',
    passed: notExpired,
    message: candidate.expiryDate === null ? 'This evidence type has no expiry date.' : notExpired ? `Valid until ${candidate.expiryDate}.` : `Expired on ${candidate.expiryDate}.`,
  })

  const embeddingReady = candidate.embeddingStatus === 'READY' || candidate.embeddingStatus === 'STALE'
  checks.push({
    code: 'EMBEDDING_AVAILABLE',
    passed: embeddingReady,
    message: embeddingReady ? `Embedding status: ${candidate.embeddingStatus}.` : `Embedding is not usable (status: ${candidate.embeddingStatus}) — semantic retrieval alone cannot have surfaced a candidate with no usable embedding; verification cannot proceed further.`,
  })

  const hardChecksPassed = agencyMatches && typeEligible && candidate.sourceActive && notExpired && embeddingReady

  const evidenceStatusKnown = candidate.evidenceStatus === 'VERIFIED' || candidate.evidenceStatus === 'INFERRED'
  checks.push({
    code: 'EVIDENCE_STATUS_KNOWN',
    passed: evidenceStatusKnown,
    message: evidenceStatusKnown ? `Underlying evidence status is ${candidate.evidenceStatus}.` : `Underlying evidence status is ${candidate.evidenceStatus} — never silently promoted to a positive determination; requires human review before it can be VERIFIED.`,
  })

  if (!hardChecksPassed) {
    return { passed: false, checks, resultingStatus: 'CANDIDATE' }
  }
  if (!evidenceStatusKnown) {
    return { passed: true, checks, resultingStatus: 'REQUIRES_VERIFICATION' }
  }
  return { passed: true, checks, resultingStatus: 'VERIFIED' }
}

function isNotExpired(expiryDate: string | null, nowIso: string): boolean {
  if (expiryDate === null) return true
  const expiry = new Date(`${expiryDate}T23:59:59Z`).getTime()
  const now = new Date(nowIso).getTime()
  if (Number.isNaN(expiry) || Number.isNaN(now)) return false
  return now <= expiry
}
