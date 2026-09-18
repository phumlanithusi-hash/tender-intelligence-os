import type { ClaimEvaluationInput, ClaimEvaluationResult } from './types.js'

/**
 * Phase 14 §11/§23 — PURE, deterministic-where-possible unsupported
 * claim engine. AI confidence is never proof (binding constraint):
 * this function only ever looks at the evidence's actual lifecycle
 * status, never a model-reported confidence score. Supported only if
 * evidence is APPROVED and CURRENT; NONE -> UNSUPPORTED (rendered as a
 * structurally unresolved block, never filled with plausible
 * language); NOT_APPROVED/APPROVED_STALE -> REQUIRES_REVIEW, never
 * silently treated as verified.
 */
export function evaluateClaimSupport(input: ClaimEvaluationInput): ClaimEvaluationResult {
  switch (input.evidenceStatus) {
    case 'APPROVED_CURRENT':
      return { supportStatus: 'SUPPORTED', reason: 'Backed by an approved, current piece of evidence.' }
    case 'APPROVED_STALE':
      return { supportStatus: 'REQUIRES_REVIEW', reason: 'The cited evidence is approved but flagged stale — requires human re-confirmation before being treated as supported.' }
    case 'NOT_APPROVED':
      return { supportStatus: 'REQUIRES_REVIEW', reason: 'The cited evidence exists but has not been human-approved (candidate/verified/rejected/superseded) — never treated as authoritative.' }
    case 'NONE':
    default:
      return { supportStatus: 'UNSUPPORTED', reason: 'No approved evidence supports this claim.' }
  }
}

/** Renders the exact placeholder text the spec mandates (§11) for an unsupported claim, so it is never silently filled with plausible language. */
export function renderUnsupportedClaimPlaceholder(): string {
  return '[REQUIRES AGENCY INPUT: Provide verified evidence supporting this claim.]'
}
