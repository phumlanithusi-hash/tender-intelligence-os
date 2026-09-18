import { describe, expect, it } from 'vitest'
import { parseEtendersDateOnly, parseEtendersTime } from '../parsers/dates.js'

describe('parseEtendersDateOnly', () => {
  it('parses "11 September 2026"', () => {
    expect(parseEtendersDateOnly('11 September 2026')).toBe('2026-09-11')
  })

  it('parses "1 September 2026, 11:00" (date with trailing time)', () => {
    expect(parseEtendersDateOnly('1 September 2026, 11:00')).toBe('2026-09-01')
  })

  it('parses "11-Sep-2026"', () => {
    expect(parseEtendersDateOnly('11-Sep-2026')).toBe('2026-09-11')
  })

  it('parses ISO "2026-09-11"', () => {
    expect(parseEtendersDateOnly('2026-09-11')).toBe('2026-09-11')
  })

  it('parses day-first slash form "11/09/2026" as 11 Sept per the documented SA convention', () => {
    expect(parseEtendersDateOnly('11/09/2026')).toBe('2026-09-11')
  })

  it('returns null for an invalid calendar date rather than a wrapped-around one', () => {
    expect(parseEtendersDateOnly('31 February 2026')).toBeNull()
  })

  it('returns null for garbage text', () => {
    expect(parseEtendersDateOnly('TBC')).toBeNull()
  })

  it('returns null for empty/whitespace/null/undefined', () => {
    expect(parseEtendersDateOnly('')).toBeNull()
    expect(parseEtendersDateOnly('   ')).toBeNull()
    expect(parseEtendersDateOnly(null)).toBeNull()
    expect(parseEtendersDateOnly(undefined)).toBeNull()
  })
})

describe('parseEtendersTime', () => {
  it('extracts a 24h time embedded in a longer date string', () => {
    expect(parseEtendersTime('30 September 2026, 11:00')).toBe('11:00')
  })

  it('pads single-digit hours', () => {
    expect(parseEtendersTime('9:05')).toBe('09:05')
  })

  it('returns null when no time is present', () => {
    expect(parseEtendersTime('30 September 2026')).toBeNull()
  })

  it('returns null for null/undefined', () => {
    expect(parseEtendersTime(null)).toBeNull()
    expect(parseEtendersTime(undefined)).toBeNull()
  })
})
