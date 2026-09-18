import { describe, expect, it } from 'vitest'
import { calculatePriceVariance, summarizeFinancials, valueBand } from '../awardAnalytics.js'

describe('valueBand (Phase 17 §32)', () => {
  it('bands a value into the correct configured range', () => {
    expect(valueBand(50_000).band).toBe('UNDER_100K')
    expect(valueBand(100_000).band).toBe('R100K_500K')
    expect(valueBand(4_999_999).band).toBe('R1M_5M')
    expect(valueBand(20_000_000).band).toBe('OVER_10M')
  })

  it('returns UNKNOWN for null/negative values, never a fabricated band', () => {
    expect(valueBand(null).band).toBe('UNKNOWN')
    expect(valueBand(-5).band).toBe('UNKNOWN')
  })
})

describe('summarizeFinancials (Phase 17 §61)', () => {
  it('excludes unknown (non-numeric) values rather than treating them as zero', () => {
    const summary = summarizeFinancials({ awardValues: [100, 200, 300] })
    expect(summary.total).toBe(600)
    expect(summary.average).toBe(200)
    expect(summary.median).toBe(200)
    expect(summary.countKnown).toBe(3)
  })

  it('returns nulls (not zero) when nothing is known', () => {
    const summary = summarizeFinancials({ awardValues: [] })
    expect(summary.total).toBe(0)
    expect(summary.average).toBeNull()
    expect(summary.median).toBeNull()
    expect(summary.countKnown).toBe(0)
  })
})

describe('calculatePriceVariance (Phase 17 §63)', () => {
  it('computes a percentage variance and labels it SYSTEM_CALCULATED, never causal', () => {
    const result = calculatePriceVariance(110_000, 100_000)
    expect(result.variancePercent).toBeCloseTo(10)
    expect(result.label).toMatch(/SYSTEM_CALCULATED/)
    expect(result.label).not.toMatch(/because we/i)
  })

  it('returns null when either value is unknown', () => {
    expect(calculatePriceVariance(null, 100_000).variancePercent).toBeNull()
    expect(calculatePriceVariance(100_000, null).variancePercent).toBeNull()
  })
})
