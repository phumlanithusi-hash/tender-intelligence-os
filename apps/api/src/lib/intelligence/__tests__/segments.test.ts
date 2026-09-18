import { describe, expect, it } from 'vitest'
import { buildSegmentedPerformance } from '../segments.js'

describe('buildSegmentedPerformance (spec §17)', () => {
  it('groups by segment key and reports sample size, verified outcomes and missing data separately', () => {
    const result = buildSegmentedPerformance([
      { segmentKey: 'IT_SERVICES', won: true },
      { segmentKey: 'IT_SERVICES', won: false },
      { segmentKey: 'IT_SERVICES', won: null },
      { segmentKey: 'CONSTRUCTION', won: true },
    ])
    const it = result.find((r) => r.segmentKey === 'IT_SERVICES')!
    expect(it.sampleSize).toBe(3)
    expect(it.verifiedOutcomes).toBe(2)
    expect(it.missingOutcomes).toBe(1)
    expect(it.observedWinRate).toBeCloseTo(0.5, 5)
  })

  it('flags insufficientSample for a thin segment', () => {
    const result = buildSegmentedPerformance([{ segmentKey: 'RARE_CATEGORY', won: true }])
    expect(result[0]!.insufficientSample).toBe(true)
    expect(result[0]!.caveat).not.toBeNull()
  })

  it('never presents a small sample without a caveat', () => {
    const result = buildSegmentedPerformance([{ segmentKey: 'X', won: true }])
    expect(result[0]!.caveat).toBeTruthy()
  })
})
