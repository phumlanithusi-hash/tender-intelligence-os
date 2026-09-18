import { describe, expect, it } from 'vitest'
import { buildBidNoBidRetrospective, buildOpportunityScoreCalibration } from '../scoreCalibration.js'

describe('buildOpportunityScoreCalibration (spec §15)', () => {
  it('buckets observations by score band and computes observed win rate per band', () => {
    const observations = [
      { opportunityScore: 85, won: true, outcomeVerified: true },
      { opportunityScore: 90, won: false, outcomeVerified: true },
      { opportunityScore: 10, won: false, outcomeVerified: true },
    ]
    const result = buildOpportunityScoreCalibration(observations)
    const highBand = result.find((r) => r.band === '80-100')!
    expect(highBand.verifiedOutcomeCount).toBe(2)
    expect(highBand.observedWinRate).toBeCloseTo(0.5, 5)
    const lowBand = result.find((r) => r.band === '0-20')!
    expect(lowBand.observedWinRate).toBe(0)
  })

  it('shows a small-sample caveat for a band with too few observations', () => {
    const observations = [{ opportunityScore: 85, won: true, outcomeVerified: true }]
    const result = buildOpportunityScoreCalibration(observations)
    const band = result.find((r) => r.band === '80-100')!
    expect(band.caveat).not.toBeNull()
  })

  it('excludes unverified outcomes from the observed win rate but counts them in sample size', () => {
    const observations = [
      { opportunityScore: 85, won: true, outcomeVerified: true },
      { opportunityScore: 85, won: false, outcomeVerified: false },
    ]
    const result = buildOpportunityScoreCalibration(observations)
    const band = result.find((r) => r.band === '80-100')!
    expect(band.sampleSize).toBe(2)
    expect(band.verifiedOutcomeCount).toBe(1)
  })
})

describe('buildBidNoBidRetrospective (spec §16)', () => {
  it('never treats a NO_BID decision as a loss', () => {
    const result = buildBidNoBidRetrospective([{ systemDecision: 'NO_BID', outcome: 'COUNTERFACTUAL_UNKNOWN' }])
    expect(result[0]!.outcome).toBe('COUNTERFACTUAL_UNKNOWN')
  })

  it('aggregates counts per (decision, outcome) pair', () => {
    const result = buildBidNoBidRetrospective([
      { systemDecision: 'BID', outcome: 'WON' },
      { systemDecision: 'BID', outcome: 'WON' },
      { systemDecision: 'BID', outcome: 'LOST' },
    ])
    const won = result.find((r) => r.systemDecision === 'BID' && r.outcome === 'WON')!
    expect(won.count).toBe(2)
  })

  it('caveats a row with a count below the minimum segment sample size', () => {
    const result = buildBidNoBidRetrospective([{ systemDecision: 'BID', outcome: 'WON' }])
    expect(result[0]!.caveat).not.toBeNull()
  })
})
