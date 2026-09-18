import { describe, expect, it } from 'vitest'
import { computeCoreMetrics, rateWithCompleteness } from '../metrics.js'

describe('rateWithCompleteness (Phase 17 §27/§28)', () => {
  it('never divides by zero — returns null rate, not NaN/Infinity', () => {
    const result = rateWithCompleteness(0, 0, 0)
    expect(result.rate).toBeNull()
    expect(result.completeness).toBeNull()
    expect(Number.isNaN(result.rate)).toBe(false)
  })

  it('computes a normal rate and completeness', () => {
    const result = rateWithCompleteness(8, 13, 18)
    expect(result.rate).toBeCloseTo(8 / 13)
    expect(result.completeness).toBeCloseTo(13 / 18)
  })

  it('flags insufficient sample below the minimum meaningful size', () => {
    expect(rateWithCompleteness(1, 1, 1).insufficientSample).toBe(true)
    expect(rateWithCompleteness(3, 5, 5).insufficientSample).toBe(false)
  })
})

describe('computeCoreMetrics (Phase 17 §27)', () => {
  it('computes all seven metrics without throwing on an all-zero input', () => {
    const metrics = computeCoreMetrics({
      totalOpportunities: 0,
      totalQualified: 0,
      totalBidDecisions: 0,
      totalEligibleForSubmission: 0,
      submittedVerified: 0,
      submittedReported: 0,
      notSubmitted: 0,
      won: 0,
      lost: 0,
      disqualified: 0,
      withdrawn: 0,
      outcomeUnknown: 0,
      noAward: 0,
      cancelled: 0,
    })
    expect(metrics.winRate.rate).toBeNull()
    expect(metrics.lossRate.rate).toBeNull()
  })

  it('win rate is wins over verified-submitted bids, not over total opportunities', () => {
    const metrics = computeCoreMetrics({
      totalOpportunities: 100,
      totalQualified: 40,
      totalBidDecisions: 20,
      totalEligibleForSubmission: 20,
      submittedVerified: 13,
      submittedReported: 2,
      notSubmitted: 5,
      won: 8,
      lost: 4,
      disqualified: 1,
      withdrawn: 0,
      outcomeUnknown: 0,
      noAward: 0,
      cancelled: 0,
    })
    expect(metrics.winRate.numerator).toBe(8)
    expect(metrics.winRate.denominator).toBe(13)
    expect(metrics.winRate.rate).toBeCloseTo(8 / 13)
  })
})
