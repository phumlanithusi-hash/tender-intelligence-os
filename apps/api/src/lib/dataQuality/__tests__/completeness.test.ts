import { describe, expect, it } from 'vitest'
import { buildCompletenessBreakdown, buildCompletenessDashboard } from '../completeness.js'

describe('buildCompletenessBreakdown', () => {
  it('never collapses buckets into a single percentage — every bucket is reported separately', () => {
    const result = buildCompletenessBreakdown('TENDER', { total: 10, known: 5, unverified: 2, unknown: 1, missing: 1, conflicting: 1 })
    expect(result).toEqual({ domain: 'TENDER', total: 10, known: 5, unverified: 2, unknown: 1, missing: 1, conflicting: 1 })
    expect(result).not.toHaveProperty('percentage')
    expect(result).not.toHaveProperty('score')
  })
})

describe('buildCompletenessDashboard', () => {
  it('produces one breakdown row per domain', () => {
    const rows = buildCompletenessDashboard({
      TENDER: { total: 1, known: 1, unverified: 0, unknown: 0, missing: 0, conflicting: 0 },
      DOCUMENT: { total: 2, known: 1, unverified: 1, unknown: 0, missing: 0, conflicting: 0 },
    })
    expect(rows.map((r) => r.domain)).toEqual(['TENDER', 'DOCUMENT'])
  })
})
