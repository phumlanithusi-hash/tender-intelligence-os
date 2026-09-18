/**
 * Phase 16 §22 — DUPLICATE SUBMISSION PROTECTION. Before any attempt,
 * the caller must check whether this exact bid already has a confirmed
 * submission (same bid, tender, target, method, approved pack,
 * provider). If one exists, further attempts require an EXPLICIT human
 * override — never automatic.
 */
export interface DuplicateCheckInput {
  existingConfirmedSubmissionExists: boolean
  samePackVersion: boolean
  sameTarget: boolean
  sameMethod: boolean
  explicitOverride: boolean
}

export type DuplicateDecision = 'PROCEED' | 'ALREADY_RECORDED_BLOCKED' | 'ALREADY_RECORDED_OVERRIDDEN'

export function checkDuplicateSubmission(input: DuplicateCheckInput): DuplicateDecision {
  if (!input.existingConfirmedSubmissionExists) return 'PROCEED'
  if (input.explicitOverride) return 'ALREADY_RECORDED_OVERRIDDEN'
  return 'ALREADY_RECORDED_BLOCKED'
}
