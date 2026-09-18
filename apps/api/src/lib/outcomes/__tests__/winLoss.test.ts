import { describe, expect, it } from 'vitest'
import { buildCalibrationTable, buildGroupedWinRate, buildOutcomeFunnel, calibrationOutcomeForDecision, groupedMetricCaveat } from '../winLoss.js'

describe('buildOutcomeFunnel (Phase 17 §50)', () => {
  it('produces real counts and percent-of-opportunities at every stage', () => {
    const funnel = buildOutcomeFunnel({ opportunities: 100, qualified: 40, bid: 20, submitted: 18, outcomeKnown: 13, won: 8 })
    expect(funnel).toHaveLength(6)
    expect(funnel[0]?.count).toBe(100)
    expect(funnel[5]?.percentOfOpportunities).toBeCloseTo(8)
  })

  it('handles zero opportunities without dividing by zero', () => {
    const funnel = buildOutcomeFunnel({ opportunities: 0, qualified: 0, bid: 0, submitted: 0, outcomeKnown: 0, won: 0 })
    expect(funnel[0]?.percentOfOpportunities).toBeNull()
  })
})

describe('buildGroupedWinRate + groupedMetricCaveat (Phase 17 §30/§31/§33)', () => {
  it('a tiny sample (1 win, 1 submitted) is caveated, never presented as a strongest category', () => {
    const rows = buildGroupedWinRate({ 'IT Services': { won: 1, verifiedSubmitted: 1 } })
    const row = rows[0]
    expect(row).toBeDefined()
    expect(row!.winRate.rate).toBe(1)
    expect(groupedMetricCaveat(row!)).toMatch(/too small a sample/i)
  })

  it('a sufficiently large sample has no caveat', () => {
    const rows = buildGroupedWinRate({ 'IT Services': { won: 3, verifiedSubmitted: 6 } })
    expect(groupedMetricCaveat(rows[0]!)).toBeNull()
  })
})

describe('calibrationOutcomeForDecision (Phase 17 §34/§36)', () => {
  it('a NO_BID decision is always COUNTERFACTUAL_UNKNOWN, never scored as a loss', () => {
    expect(calibrationOutcomeForDecision('NO_BID', null)).toBe('COUNTERFACTUAL_UNKNOWN')
    expect(calibrationOutcomeForDecision('NO_BID', 'LOST')).toBe('COUNTERFACTUAL_UNKNOWN')
  })

  it('a BID decision reflects the actual recorded result', () => {
    expect(calibrationOutcomeForDecision('BID', 'WON')).toBe('WON')
    expect(calibrationOutcomeForDecision('BID', null)).toBe('UNKNOWN')
  })
})

describe('buildCalibrationTable', () => {
  it('aggregates rows into counts per (decision, outcome) pair', () => {
    const table = buildCalibrationTable([
      { systemDecision: 'BID', outcome: 'WON' },
      { systemDecision: 'BID', outcome: 'WON' },
      { systemDecision: 'BID', outcome: 'LOST' },
      { systemDecision: 'NO_BID', outcome: 'COUNTERFACTUAL_UNKNOWN' },
    ])
    const bidWon = table.find((r) => r.systemDecision === 'BID' && r.outcome === 'WON')
    expect(bidWon?.count).toBe(2)
  })
})
