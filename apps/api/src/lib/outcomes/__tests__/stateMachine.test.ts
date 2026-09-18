import { describe, expect, it } from 'vitest'
import { evaluateOutcomeFollowUp, resolveTruthStatus, transitionOutcomeReview } from '../stateMachine.js'

describe('transitionOutcomeReview (Phase 17 §18)', () => {
  it('cannot verify without evidence', () => {
    const result = transitionOutcomeReview({ currentStage: 'HUMAN_REVIEW', targetStage: 'VERIFIED', hasEvidence: false, reviewerRoleAllowed: true })
    expect(result.allowed).toBe(false)
  })

  it('cannot verify without an allowed role, even with evidence', () => {
    const result = transitionOutcomeReview({ currentStage: 'HUMAN_REVIEW', targetStage: 'VERIFIED', hasEvidence: true, reviewerRoleAllowed: false })
    expect(result.allowed).toBe(false)
  })

  it('verifies when evidence + role are both satisfied', () => {
    const result = transitionOutcomeReview({ currentStage: 'HUMAN_REVIEW', targetStage: 'VERIFIED', hasEvidence: true, reviewerRoleAllowed: true })
    expect(result.allowed).toBe(true)
  })

  it('rejects skipping stages (DISCOVERED -> VERIFIED directly)', () => {
    const result = transitionOutcomeReview({ currentStage: 'DISCOVERED', targetStage: 'VERIFIED', hasEvidence: true, reviewerRoleAllowed: true })
    expect(result.allowed).toBe(false)
  })
})

describe('resolveTruthStatus (Phase 17 §16)', () => {
  it('never VERIFIED without both evidence and human verification', () => {
    expect(resolveTruthStatus(true, false, false)).not.toBe('VERIFIED')
    expect(resolveTruthStatus(false, true, false)).not.toBe('VERIFIED')
    expect(resolveTruthStatus(true, true, false)).toBe('VERIFIED')
  })

  it('a system-inferred value without evidence is INFERRED, not UNKNOWN', () => {
    expect(resolveTruthStatus(false, false, true)).toBe('INFERRED')
  })
})

describe('evaluateOutcomeFollowUp (Phase 17 §55)', () => {
  it('flags follow-up required after the threshold with no known outcome', () => {
    const result = evaluateOutcomeFollowUp({
      submissionStatus: 'VERIFIED_SUBMITTED',
      outcomeKnown: false,
      submittedAtIso: '2026-06-01T00:00:00Z',
      nowIso: '2026-09-01T00:00:00Z',
    })
    expect(result.requiresFollowUp).toBe(true)
  })

  it('does not require follow-up once the outcome is known', () => {
    const result = evaluateOutcomeFollowUp({
      submissionStatus: 'VERIFIED_SUBMITTED',
      outcomeKnown: true,
      submittedAtIso: '2026-06-01T00:00:00Z',
      nowIso: '2026-09-01T00:00:00Z',
    })
    expect(result.requiresFollowUp).toBe(false)
  })

  it('never treats a NOT_SUBMITTED bid as needing outcome follow-up', () => {
    const result = evaluateOutcomeFollowUp({
      submissionStatus: 'NOT_SUBMITTED',
      outcomeKnown: false,
      submittedAtIso: null,
      nowIso: '2026-09-01T00:00:00Z',
    })
    expect(result.requiresFollowUp).toBe(false)
  })

  it('never auto-marks the result as lost — only ever returns a follow-up recommendation', () => {
    const result = evaluateOutcomeFollowUp({
      submissionStatus: 'VERIFIED_SUBMITTED',
      outcomeKnown: false,
      submittedAtIso: '2026-01-01T00:00:00Z',
      nowIso: '2026-09-01T00:00:00Z',
    })
    expect(result.reason).toMatch(/not auto-marked as lost/i)
  })
})
