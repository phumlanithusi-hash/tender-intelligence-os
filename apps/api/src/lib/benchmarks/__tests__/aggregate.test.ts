import { describe, expect, it } from 'vitest'
import { aggregateCycleTimes, aggregatePriceVariance, aggregateVolume } from '../aggregate.js'

function cycleFact(overrides: Partial<Parameters<typeof aggregateCycleTimes>[0][number]> = {}) {
  return {
    tenderId: 't1',
    category: 'Media & Design',
    region: 'Gauteng',
    publishedDate: '2026-01-01',
    decisionDate: '2026-02-01',
    distinctEntityKey: 'entity-1',
    ...overrides,
  }
}

describe('aggregateCycleTimes (k-anonymity)', () => {
  it('masks a group with fewer than 5 distinct entities', () => {
    const facts = [1, 2, 3, 4].map((n) => cycleFact({ tenderId: `t${n}`, distinctEntityKey: `entity-${n}` }))
    const result = aggregateCycleTimes(facts)
    expect(result).toHaveLength(1)
    expect(result[0]!.sufficientData).toBe(false)
    expect(result[0]!.p50).toBeNull()
    expect(result[0]!.sampleSize).toBe(4)
  })

  it('reveals real statistics once exactly 5 distinct entities are present', () => {
    const facts = [1, 2, 3, 4, 5].map((n) => cycleFact({ tenderId: `t${n}`, distinctEntityKey: `entity-${n}` }))
    const result = aggregateCycleTimes(facts)
    expect(result[0]!.sufficientData).toBe(true)
    expect(result[0]!.sampleSize).toBe(5)
    expect(result[0]!.p50).toBeCloseTo(31, 0)
  })

  it('never counts the same entity twice toward the k-anonymity floor', () => {
    // 10 facts but only 4 distinct entities — must still be masked.
    const facts = Array.from({ length: 10 }, (_, i) => cycleFact({ tenderId: `t${i}`, distinctEntityKey: `entity-${i % 4}` }))
    const result = aggregateCycleTimes(facts)
    expect(result[0]!.sufficientData).toBe(false)
  })

  it('excludes facts missing a publication or decision date rather than fabricating a cycle time', () => {
    const facts = [cycleFact({ publishedDate: null as unknown as string }), cycleFact({ decisionDate: null as unknown as string })]
    const result = aggregateCycleTimes(facts)
    expect(result).toHaveLength(0)
  })

  it('groups independently by category and region', () => {
    const facts = [
      ...[1, 2, 3, 4, 5].map((n) => cycleFact({ tenderId: `a${n}`, distinctEntityKey: `a-${n}`, category: 'Media & Design', region: 'Gauteng' })),
      ...[1, 2, 3].map((n) => cycleFact({ tenderId: `b${n}`, distinctEntityKey: `b-${n}`, category: 'IT Services', region: 'Western Cape' })),
    ]
    const result = aggregateCycleTimes(facts)
    expect(result).toHaveLength(2)
    const mediaGroup = result.find((r) => r.category === 'Media & Design')!
    const itGroup = result.find((r) => r.category === 'IT Services')!
    expect(mediaGroup.sufficientData).toBe(true)
    expect(itGroup.sufficientData).toBe(false)
  })
})

describe('aggregatePriceVariance', () => {
  it('masks below k=5 and reveals mean/stddev at k=5', () => {
    const below = [1, 2, 3, 4].map((n) => ({ tenderId: `t${n}`, category: 'Media & Design', region: 'Gauteng', awardValue: 100_000, distinctEntityKey: `e${n}` }))
    expect(aggregatePriceVariance(below)[0]!.sufficientData).toBe(false)

    const atFloor = [100_000, 150_000, 200_000, 120_000, 180_000].map((v, n) => ({
      tenderId: `t${n}`,
      category: 'Media & Design',
      region: 'Gauteng',
      awardValue: v,
      distinctEntityKey: `e${n}`,
    }))
    const result = aggregatePriceVariance(atFloor)[0]!
    expect(result.sufficientData).toBe(true)
    expect(result.mean).toBeCloseTo(150_000, 0)
    expect(result.stddev).toBeGreaterThan(0)
  })

  it('never leaks a raw award value — only aggregate mean/percentile fields exist on the result shape', () => {
    const facts = [100_000, 150_000, 200_000, 120_000, 180_000].map((v, n) => ({
      tenderId: `t${n}`,
      category: 'Media & Design',
      region: 'Gauteng',
      awardValue: v,
      distinctEntityKey: `e${n}`,
    }))
    const result = aggregatePriceVariance(facts)[0]!
    expect(Object.keys(result).sort()).toEqual(['category', 'mean', 'metricType', 'p25', 'p50', 'p75', 'region', 'sampleSize', 'stddev', 'sufficientData'].sort())
  })
})

describe('aggregateVolume', () => {
  it('counts distinct tenders per category/region and masks below k=5', () => {
    const facts = [1, 2, 3].map((n) => ({ tenderId: `t${n}`, category: 'Media & Design', region: 'Gauteng', discoveredDate: '2026-01-01' }))
    expect(aggregateVolume(facts)[0]!.sufficientData).toBe(false)
  })

  it('a duplicate tenderId is counted once, never inflating the volume', () => {
    const facts = [
      { tenderId: 't1', category: 'Media & Design', region: 'Gauteng', discoveredDate: '2026-01-01' },
      { tenderId: 't1', category: 'Media & Design', region: 'Gauteng', discoveredDate: '2026-01-02' },
      { tenderId: 't2', category: 'Media & Design', region: 'Gauteng', discoveredDate: '2026-01-01' },
      { tenderId: 't3', category: 'Media & Design', region: 'Gauteng', discoveredDate: '2026-01-01' },
      { tenderId: 't4', category: 'Media & Design', region: 'Gauteng', discoveredDate: '2026-01-01' },
      { tenderId: 't5', category: 'Media & Design', region: 'Gauteng', discoveredDate: '2026-01-01' },
    ]
    const result = aggregateVolume(facts)[0]!
    expect(result.sampleSize).toBe(5)
    expect(result.sufficientData).toBe(true)
  })
})
