import { describe, expect, it } from 'vitest'
import { buildDecisionTimeFeatures } from '../learningFeatures.js'
import { OUTCOME_ONLY_FIELDS } from '../types.js'
import type { DecisionTimeRawInput } from '../learningFeatures.js'

/**
 * Phase 19 §19 regression tests — "Never allow CURRENT SCORE to
 * replace SCORE AT DECISION... post-outcome data must never enter
 * decision-time features." These are re-verification tests of the
 * Phase 17 boundary (`assertNoOutcomeLeakage`,
 * `learningFeatures.test.ts`), added specifically because Phase 19's
 * own spec (§19) demands dedicated regression coverage for this exact
 * property, not just trusting it was covered once in an earlier phase.
 */
const validDecisionRaw: DecisionTimeRawInput = {
  bidProjectId: 'bp-1',
  tenderCategory: 'CONSTRUCTION',
  organisationType: 'MUNICIPALITY',
  province: 'GAUTENG',
  estimatedValueAtDecision: 500_000,
  qualificationStatusAtDecision: 'QUALIFIED',
  requirementCoverageAtDecision: 0.9,
  evaluationFitAtDecision: 0.8,
  evidenceStrengthAtDecision: 0.7,
  commercialFitAtDecision: 0.6,
  strategicFitAtDecision: 0.5,
  opportunityScoreAtDecision: 72,
  bidEffort: 'MEDIUM',
  bidDecision: 'BID',
  submissionMethod: 'PORTAL',
}

describe('historical integrity — decision-time features can never carry post-outcome or "current" data (spec §19)', () => {
  it('a decision-time snapshot built from a valid raw input never contains any OUTCOME_ONLY_FIELDS key', () => {
    const features = buildDecisionTimeFeatures(validDecisionRaw)
    const keys = Object.keys(features as unknown as Record<string, unknown>)
    for (const forbidden of OUTCOME_ONLY_FIELDS) {
      expect(keys).not.toContain(forbidden)
    }
  })

  it('the snapshot is exactly the *AtDecision fields — it never silently absorbs an unexpected extra property from a raw input carrying a smuggled current-state field', () => {
    const tampered = { ...validDecisionRaw, currentScore: 99, currentPolicy: 'v2', currentStrategy: 'aggressive' } as DecisionTimeRawInput
    const features = buildDecisionTimeFeatures(tampered)
    expect(features).not.toHaveProperty('currentScore')
    expect(features).not.toHaveProperty('currentPolicy')
    expect(features).not.toHaveProperty('currentStrategy')
    // The only score-shaped field on the snapshot is the AT-DECISION one, and it is exactly what was passed in — never replaced by any "current" value.
    expect(features.opportunityScoreAtDecision).toBe(validDecisionRaw.opportunityScoreAtDecision)
  })

  it('rejects a raw input that already carries a post-outcome field (award_value, winner, loss_reason, winning_score) rather than silently stripping it', () => {
    expect(() => buildDecisionTimeFeatures({ ...validDecisionRaw, awardValue: 1_000_000 } as unknown as DecisionTimeRawInput)).toThrow(/data-leakage/)
    expect(() => buildDecisionTimeFeatures({ ...validDecisionRaw, winner: 'Acme Co' } as unknown as DecisionTimeRawInput)).toThrow(/data-leakage/)
    expect(() => buildDecisionTimeFeatures({ ...validDecisionRaw, winningScore: 88 } as unknown as DecisionTimeRawInput)).toThrow(/data-leakage/)
    expect(() => buildDecisionTimeFeatures({ ...validDecisionRaw, lossReasonPrimary: 'PRICE' } as unknown as DecisionTimeRawInput)).toThrow(/data-leakage/)
  })

  it('two calls with the identical raw input produce byte-identical output — deterministic, never influenced by "now"', () => {
    const a = buildDecisionTimeFeatures(validDecisionRaw)
    const b = buildDecisionTimeFeatures(validDecisionRaw)
    expect(a).toEqual(b)
  })
})
