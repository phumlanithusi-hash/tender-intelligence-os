import { describe, expect, it } from 'vitest'
import { SCORING_WEIGHTS, SCORING_TOTAL, SCORE_CLASSIFICATION_BANDS } from './scoring.js'

describe('scoring weights', () => {
  it('sum exactly to 100, per spec §22', () => {
    expect(SCORING_TOTAL).toBe(100)
  })

  it('never has a negative or zero weight', () => {
    for (const weight of Object.values(SCORING_WEIGHTS)) {
      expect(weight).toBeGreaterThan(0)
    }
  })

  it('classification bands cover the full 0-100 range with no gaps', () => {
    const sorted = [...SCORE_CLASSIFICATION_BANDS].sort((a, b) => a.min - b.min)
    expect(sorted[0]?.min).toBe(0)
    expect(sorted[sorted.length - 1]?.max).toBe(100)
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]?.min).toBe((sorted[i - 1]?.max ?? 0) + 1)
    }
  })
})
