import { describe, expect, it } from 'vitest'
import { matchWinnerToAgency } from '../winnerMatch.js'

describe('matchWinnerToAgency — registration-number path (Phase 17 gap-close)', () => {
  it('matches on equal registration numbers even if the names differ', () => {
    const result = matchWinnerToAgency({
      agencyName: 'Acme Trading (Pty) Ltd',
      agencyRegistrationNumber: '2019/123456/07',
      winnerName: 'Acme Holdings Ltd', // deliberately a different trading name
      winnerRegistrationNumber: '2019/123456/07',
    })
    expect(result).toEqual({ weAreWinner: true, matchBasis: 'REGISTRATION_NUMBER' })
  })

  it('tolerates whitespace/punctuation differences in registration numbers', () => {
    const result = matchWinnerToAgency({
      agencyName: 'Acme Trading (Pty) Ltd',
      agencyRegistrationNumber: '2019 / 123456 / 07',
      winnerName: 'Acme Trading (Pty) Ltd',
      winnerRegistrationNumber: '2019/123456/07',
    })
    expect(result.matchBasis).toBe('REGISTRATION_NUMBER')
    expect(result.weAreWinner).toBe(true)
  })

  it('never lets a name-based guess override disagreeing registration numbers (no false positive)', () => {
    const result = matchWinnerToAgency({
      agencyName: 'Acme Trading (Pty) Ltd',
      agencyRegistrationNumber: '2019/123456/07',
      winnerName: 'Acme Trading (Pty) Ltd', // identical name
      winnerRegistrationNumber: '2020/999999/07', // but a different registration number
    })
    expect(result).toEqual({ weAreWinner: false, matchBasis: 'REGISTRATION_NUMBER' })
  })

  it('is case-sensitive-safe (registration numbers are not case-normalised beyond trim/whitespace) but still matches identical values', () => {
    const result = matchWinnerToAgency({
      agencyName: 'Acme',
      agencyRegistrationNumber: '2019/123456/07',
      winnerName: 'Acme',
      winnerRegistrationNumber: '2019/123456/07',
    })
    expect(result.weAreWinner).toBe(true)
  })
})

describe('matchWinnerToAgency — name fallback (Phase 17 gap-close)', () => {
  it('falls back to a case-insensitive name match when only the agency has a registration number', () => {
    const result = matchWinnerToAgency({
      agencyName: 'Acme Trading',
      agencyRegistrationNumber: '2019/123456/07',
      winnerName: 'acme trading',
      winnerRegistrationNumber: null,
    })
    expect(result).toEqual({ weAreWinner: true, matchBasis: 'NAME' })
  })

  it('falls back to a case-insensitive name match when only the winner has a registration number', () => {
    const result = matchWinnerToAgency({
      agencyName: 'Acme Trading',
      agencyRegistrationNumber: null,
      winnerName: 'ACME TRADING',
      winnerRegistrationNumber: '2019/123456/07',
    })
    expect(result).toEqual({ weAreWinner: true, matchBasis: 'NAME' })
  })

  it('falls back to a case-insensitive name match when neither side has a registration number', () => {
    const result = matchWinnerToAgency({
      agencyName: 'Acme Trading',
      agencyRegistrationNumber: null,
      winnerName: 'acme trading',
      winnerRegistrationNumber: null,
    })
    expect(result).toEqual({ weAreWinner: true, matchBasis: 'NAME' })
  })

  it('name fallback correctly reports a mismatch as false, not null', () => {
    const result = matchWinnerToAgency({
      agencyName: 'Acme Trading',
      agencyRegistrationNumber: null,
      winnerName: 'Other Entity',
      winnerRegistrationNumber: null,
    })
    expect(result).toEqual({ weAreWinner: false, matchBasis: 'NAME' })
  })
})

describe('matchWinnerToAgency — insufficient data (Phase 17 gap-close)', () => {
  it('returns UNKNOWN (null), never a guess, when neither name nor registration number is available on both sides', () => {
    expect(matchWinnerToAgency({ agencyName: null, agencyRegistrationNumber: null, winnerName: null, winnerRegistrationNumber: null })).toEqual({
      weAreWinner: null,
      matchBasis: 'INSUFFICIENT_DATA',
    })
    expect(matchWinnerToAgency({ agencyName: 'Acme', agencyRegistrationNumber: null, winnerName: null, winnerRegistrationNumber: null })).toEqual({
      weAreWinner: null,
      matchBasis: 'INSUFFICIENT_DATA',
    })
    expect(matchWinnerToAgency({ agencyName: null, agencyRegistrationNumber: null, winnerName: 'Acme', winnerRegistrationNumber: null })).toEqual({
      weAreWinner: null,
      matchBasis: 'INSUFFICIENT_DATA',
    })
  })

  it('treats an empty/whitespace-only registration number as absent, not as a match key', () => {
    const result = matchWinnerToAgency({
      agencyName: 'Acme',
      agencyRegistrationNumber: '   ',
      winnerName: 'Acme',
      winnerRegistrationNumber: '   ',
    })
    // both sides "have" only whitespace, which normalises to null on both —
    // this must fall back to the name match, not treat '' === '' as a
    // registration-number match.
    expect(result).toEqual({ weAreWinner: true, matchBasis: 'NAME' })
  })
})
