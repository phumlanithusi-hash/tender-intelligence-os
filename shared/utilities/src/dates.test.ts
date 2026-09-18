import { describe, expect, it } from 'vitest'
import { daysRemaining, isClosingSoon } from './dates.js'

describe('daysRemaining', () => {
  it('returns 0 for a closing date that is today', () => {
    const now = new Date('2026-01-15T09:00:00Z')
    const closing = new Date('2026-01-15T18:00:00Z')
    expect(daysRemaining(closing, now)).toBe(0)
  })

  it('returns a positive count for a future date', () => {
    const now = new Date('2026-01-01T00:00:00Z')
    const closing = new Date('2026-01-08T00:00:00Z')
    expect(daysRemaining(closing, now)).toBe(7)
  })

  it('returns a negative count for a past date, never hiding it', () => {
    const now = new Date('2026-01-10T00:00:00Z')
    const closing = new Date('2026-01-01T00:00:00Z')
    expect(daysRemaining(closing, now)).toBe(-9)
  })
})

describe('isClosingSoon', () => {
  it('is true within the default 7-day window', () => {
    const now = new Date('2026-01-01T00:00:00Z')
    const closing = new Date('2026-01-05T00:00:00Z')
    expect(isClosingSoon(closing, 7, now)).toBe(true)
  })

  it('is false outside the window', () => {
    const now = new Date('2026-01-01T00:00:00Z')
    const closing = new Date('2026-01-20T00:00:00Z')
    expect(isClosingSoon(closing, 7, now)).toBe(false)
  })

  it('is false once the deadline has passed', () => {
    const now = new Date('2026-01-10T00:00:00Z')
    const closing = new Date('2026-01-01T00:00:00Z')
    expect(isClosingSoon(closing, 7, now)).toBe(false)
  })
})
