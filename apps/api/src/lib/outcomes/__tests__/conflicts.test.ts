import { describe, expect, it } from 'vitest'
import { detectConflict, outcomeIdentityKey } from '../conflicts.js'

describe('detectConflict (Phase 17 §17/§58)', () => {
  it('agreeing values are not a conflict', () => {
    const result = detectConflict({ fieldName: 'winner_name', existingValue: 'ABC Creative', incomingValue: 'abc creative', existingAuthorityLevel: 'PRIMARY', incomingAuthorityLevel: 'SECONDARY' })
    expect(result.hasConflict).toBe(false)
  })

  it('disagreeing values are ALWAYS routed to OPEN conflict, regardless of authority level', () => {
    const result = detectConflict({ fieldName: 'winner_name', existingValue: 'ABC Creative', incomingValue: 'XYZ Solutions', existingAuthorityLevel: 'SECONDARY', incomingAuthorityLevel: 'PRIMARY' })
    expect(result.hasConflict).toBe(true)
    expect(result.status).toBe('OPEN')
  })

  it('no existing value means nothing to conflict with yet', () => {
    const result = detectConflict({ fieldName: 'award_value', existingValue: null, incomingValue: '100000', existingAuthorityLevel: null, incomingAuthorityLevel: 'PRIMARY' })
    expect(result.hasConflict).toBe(false)
  })
})

describe('outcomeIdentityKey (Phase 17 §58 deduplication)', () => {
  it('is stable for the same tender/organisation/winner/date regardless of case', () => {
    const a = outcomeIdentityKey({ tenderNumber: 'T-1', organisation: 'DoH', winnerName: 'ABC Creative', awardDate: '2026-01-01' })
    const b = outcomeIdentityKey({ tenderNumber: 'T-1', organisation: 'DoH', winnerName: 'abc creative', awardDate: '2026-01-01' })
    expect(a).toBe(b)
  })

  it('differs when the winner differs — never silently merged', () => {
    const a = outcomeIdentityKey({ tenderNumber: 'T-1', organisation: 'DoH', winnerName: 'ABC Creative', awardDate: '2026-01-01' })
    const b = outcomeIdentityKey({ tenderNumber: 'T-1', organisation: 'DoH', winnerName: 'XYZ Solutions', awardDate: '2026-01-01' })
    expect(a).not.toBe(b)
  })
})
