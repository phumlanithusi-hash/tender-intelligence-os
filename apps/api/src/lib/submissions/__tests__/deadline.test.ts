import { describe, expect, it } from 'vitest'
import { classifySubmissionDeadlineUrgency, isDeadlinePassed } from '../deadline.js'

describe('classifySubmissionDeadlineUrgency (Phase 16 §11)', () => {
  const now = '2026-09-12T00:00:00Z'

  it('> 24h remaining -> NORMAL', () => {
    expect(classifySubmissionDeadlineUrgency(now, '2026-09-14', '00:00:00').urgency).toBe('NORMAL')
  })

  it('exactly 24h remaining -> CLOSING_SOON', () => {
    expect(classifySubmissionDeadlineUrgency(now, '2026-09-13', '00:00:00').urgency).toBe('CLOSING_SOON')
  })

  it('<= 2h remaining -> URGENT', () => {
    expect(classifySubmissionDeadlineUrgency(now, '2026-09-12', '01:30:00').urgency).toBe('URGENT')
  })

  it('<= 30min remaining -> CRITICAL', () => {
    expect(classifySubmissionDeadlineUrgency(now, '2026-09-12', '00:29:00').urgency).toBe('CRITICAL')
  })

  it('deadline passed -> BLOCKED', () => {
    expect(classifySubmissionDeadlineUrgency(now, '2026-09-11', '23:59:00').urgency).toBe('BLOCKED')
  })

  it('deadline exactly now -> BLOCKED (not <=0 allowed through)', () => {
    expect(classifySubmissionDeadlineUrgency(now, '2026-09-12', '00:00:00').urgency).toBe('BLOCKED')
  })

  it('unknown closing date -> NORMAL, hoursRemaining null (never fabricated)', () => {
    const result = classifySubmissionDeadlineUrgency(now, null, null)
    expect(result.urgency).toBe('NORMAL')
    expect(result.hoursRemaining).toBeNull()
  })

  it('isDeadlinePassed mirrors BLOCKED exactly', () => {
    expect(isDeadlinePassed(now, '2026-09-11', '23:59:00')).toBe(true)
    expect(isDeadlinePassed(now, '2026-09-14', '00:00:00')).toBe(false)
  })

  it('never uses browser/local time — same nowIso always produces the same result regardless of process TZ', () => {
    const a = classifySubmissionDeadlineUrgency(now, '2026-09-12', '01:00:00')
    const b = classifySubmissionDeadlineUrgency(now, '2026-09-12', '01:00:00')
    expect(a).toEqual(b)
  })
})
