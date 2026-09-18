import { describe, expect, it } from 'vitest'
import { assertNoCausalLanguage, sampleSizeCaveat } from '../provenance.js'
import { summarizeCompetitor } from '../competitorAnalytics.js'

describe('sampleSizeCaveat (Phase 17 §31)', () => {
  it('caveats a sample of 1 as a 100% win rate would otherwise mislead', () => {
    expect(sampleSizeCaveat(1)).toMatch(/too small/i)
  })
  it('no caveat once the sample is meaningful', () => {
    expect(sampleSizeCaveat(5)).toBeNull()
  })
})

describe('assertNoCausalLanguage (Phase 17 §86)', () => {
  it('throws on "caused", "guarantees", "proves", "will win"', () => {
    expect(() => assertNoCausalLanguage('This caused the loss.')).toThrow()
    expect(() => assertNoCausalLanguage('Strong evidence guarantees success.')).toThrow()
    expect(() => assertNoCausalLanguage('This proves the theory.')).toThrow()
    expect(() => assertNoCausalLanguage('This bid will win.')).toThrow()
  })
  it('allows hedged, associative language', () => {
    expect(() => assertNoCausalLanguage('Higher scores are associated with higher recorded win rates.')).not.toThrow()
  })
})

describe('summarizeCompetitor (Phase 17 §64/§65/§90)', () => {
  it('describes observed counts, never a fabricated market win-rate claim', () => {
    const summary = summarizeCompetitor('c1', [
      { competitorId: 'c1', result: 'WINNER', tenderId: 't1' },
      { competitorId: 'c1', result: 'BIDDER', tenderId: 't2' },
      { competitorId: 'c2', result: 'WINNER', tenderId: 't3' },
    ])
    expect(summary.recordedBids).toBe(2)
    expect(summary.verifiedWins).toBe(1)
    expect(summary.dataQualityCaveat).toMatch(/not a market win-rate/i)
  })

  it('zero activity is never presented as evidence the competitor was absent', () => {
    const summary = summarizeCompetitor('unknown-co', [])
    expect(summary.dataQualityCaveat).toMatch(/not evidence of absence/i)
  })
})
