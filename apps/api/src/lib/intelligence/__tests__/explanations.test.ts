import { describe, expect, it } from 'vitest'
import { buildAbstentionExplanation, buildPredictionExplanation } from '../explanations.js'

describe('buildPredictionExplanation (spec §14/§25)', () => {
  it('uses associative, never causal, language', () => {
    const text = buildPredictionExplanation(0.68, 40, [{ feature: 'opportunityScore', contribution: 0.5 }], [{ feature: 'evidenceStrength', contribution: -0.2 }], [], 'v1')
    expect(text).toMatch(/associated with/)
    expect(text).not.toMatch(/will win because/i)
    expect(text).not.toMatch(/\bcaused\b/i)
    expect(text).not.toMatch(/\bguarantees\b/i)
  })

  it('always includes the decision-support disclaimer', () => {
    const text = buildPredictionExplanation(0.5, 40, [], [], [], 'v1')
    expect(text).toMatch(/decision support, not a procurement decision/)
  })

  it('lists missing features when present', () => {
    const text = buildPredictionExplanation(0.5, 40, [], [], ['evidenceStrength'], 'v1')
    expect(text).toMatch(/Missing decision-time feature/)
    expect(text).toMatch(/evidenceStrength/)
  })

  it('flags a small sample size as illustrative rather than a strong conclusion', () => {
    const text = buildPredictionExplanation(0.5, 3, [], [], [], 'v1')
    expect(text).toMatch(/small sample/)
  })

  it('throws (rather than silently emitting causal language) if a causal phrase somehow ends up in the assembled explanation', () => {
    // labelFeature() only recognises known feature keys and returns
    // the raw key unchanged for anything else, so an unexpected raw
    // key containing causal language flows through to the final
    // sentence — and assertNoCausalLanguage catches it there, as the
    // single choke point every learning-layer statement must pass
    // through (spec §14/§25).
    expect(() => buildPredictionExplanation(0.5, 40, [{ feature: 'x will win because y', contribution: 1 }], [], [], 'v1')).toThrow(/causal language/)
  })
})

describe('buildAbstentionExplanation', () => {
  it('states the abstention is an expected, correct system state', () => {
    const text = buildAbstentionExplanation('INSUFFICIENT_VERIFIED_OUTCOMES', 'Not enough data.')
    expect(text).toMatch(/expected, correct system state/)
    expect(text).toMatch(/not a system failure/)
  })
})
