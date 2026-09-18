import { describe, expect, it } from 'vitest'
import { selectSourcesDueForPoll, parsePostgresIntervalToMinutes, type PollableSource } from '../schedule.js'

const NOW = '2026-09-12T12:00:00.000Z'

function source(overrides: Partial<PollableSource> = {}): PollableSource {
  return { id: 's1', scanFrequencyMinutes: 60, lastScanAt: '2026-09-12T10:00:00.000Z', adapterState: 'ACTIVE', ...overrides }
}

describe('selectSourcesDueForPoll', () => {
  it('is due when the scan frequency has elapsed since the last scan', () => {
    const [result] = selectSourcesDueForPoll([source()], NOW)
    expect(result!.due).toBe(true)
  })

  it('is not due when the scan frequency has not yet elapsed', () => {
    const [result] = selectSourcesDueForPoll([source({ lastScanAt: '2026-09-12T11:50:00.000Z' })], NOW)
    expect(result!.due).toBe(false)
  })

  it('is due when the source has never been scanned', () => {
    const [result] = selectSourcesDueForPoll([source({ lastScanAt: null })], NOW)
    expect(result!.due).toBe(true)
    expect(result!.reason).toContain('Never scanned')
  })

  it('is never due for a source that is not ACTIVE — never guesses a cadence for an unconnected source', () => {
    const [result] = selectSourcesDueForPoll([source({ adapterState: 'CONFIGURED' })], NOW)
    expect(result!.due).toBe(false)
    expect(result!.reason).toContain('CONFIGURED')
  })

  it('is never due when no scan frequency is configured', () => {
    const [result] = selectSourcesDueForPoll([source({ scanFrequencyMinutes: null })], NOW)
    expect(result!.due).toBe(false)
  })

  it('evaluates each source independently', () => {
    const results = selectSourcesDueForPoll(
      [source({ id: 'a', lastScanAt: '2026-09-12T10:00:00.000Z' }), source({ id: 'b', lastScanAt: '2026-09-12T11:59:00.000Z' })],
      NOW,
    )
    expect(results.find((r) => r.sourceId === 'a')!.due).toBe(true)
    expect(results.find((r) => r.sourceId === 'b')!.due).toBe(false)
  })
})

describe('parsePostgresIntervalToMinutes', () => {
  it('parses a plain "N day(s)" interval', () => {
    expect(parsePostgresIntervalToMinutes('1 day')).toBe(1440)
    expect(parsePostgresIntervalToMinutes('2 days')).toBe(2880)
  })

  it('parses an HH:MM:SS interval', () => {
    expect(parsePostgresIntervalToMinutes('01:00:00')).toBe(60)
    expect(parsePostgresIntervalToMinutes('00:30:00')).toBe(30)
  })

  it('parses a combined "N days HH:MM:SS" interval', () => {
    expect(parsePostgresIntervalToMinutes('1 day 02:00:00')).toBe(1560)
  })

  it('parses a plain number as seconds', () => {
    expect(parsePostgresIntervalToMinutes(3600)).toBe(60)
  })

  it('returns null for null or unparseable input, never a guessed default', () => {
    expect(parsePostgresIntervalToMinutes(null)).toBeNull()
    expect(parsePostgresIntervalToMinutes('not an interval')).toBeNull()
  })
})
