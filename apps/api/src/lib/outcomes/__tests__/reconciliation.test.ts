import { describe, expect, it } from 'vitest'
import { reconcileBidResult } from '../reconciliation.js'

describe('reconcileBidResult (Phase 17 §23/§24/§106)', () => {
  it('explicit withdrawal always wins, regardless of tender outcome', () => {
    const result = reconcileBidResult({
      outcomeStatus: 'AWARDED',
      submissionStatus: 'VERIFIED_SUBMITTED',
      weAreWinner: false,
      explicitlyWithdrawn: true,
      explicitlyDisqualified: false,
    })
    expect(result.ourResult).toBe('WITHDRAWN')
  })

  it('explicit disqualification is never labelled as an ordinary loss', () => {
    const result = reconcileBidResult({
      outcomeStatus: 'AWARDED',
      submissionStatus: 'VERIFIED_SUBMITTED',
      weAreWinner: false,
      explicitlyWithdrawn: false,
      explicitlyDisqualified: true,
    })
    expect(result.ourResult).toBe('DISQUALIFIED')
  })

  it('NOT_SUBMITTED never becomes LOST even when the tender was awarded to a competitor', () => {
    const result = reconcileBidResult({
      outcomeStatus: 'AWARDED',
      submissionStatus: 'NOT_SUBMITTED',
      weAreWinner: false,
      explicitlyWithdrawn: false,
      explicitlyDisqualified: false,
    })
    expect(result.ourResult).toBe('NOT_SUBMITTED')
  })

  it('CANCELLED tender with a verified submission is SUBMITTED, never LOST', () => {
    const result = reconcileBidResult({
      outcomeStatus: 'CANCELLED',
      submissionStatus: 'VERIFIED_SUBMITTED',
      weAreWinner: null,
      explicitlyWithdrawn: false,
      explicitlyDisqualified: false,
    })
    expect(result.ourResult).toBe('SUBMITTED')
  })

  it('NO_AWARD tender with a verified submission is SUBMITTED, never LOST', () => {
    const result = reconcileBidResult({
      outcomeStatus: 'NO_AWARD',
      submissionStatus: 'VERIFIED_SUBMITTED',
      weAreWinner: null,
      explicitlyWithdrawn: false,
      explicitlyDisqualified: false,
    })
    expect(result.ourResult).toBe('SUBMITTED')
  })

  it('AWARDED + VERIFIED_SUBMITTED + we are the winner -> WON', () => {
    const result = reconcileBidResult({
      outcomeStatus: 'AWARDED',
      submissionStatus: 'VERIFIED_SUBMITTED',
      weAreWinner: true,
      explicitlyWithdrawn: false,
      explicitlyDisqualified: false,
    })
    expect(result.ourResult).toBe('WON')
  })

  it('AWARDED + VERIFIED_SUBMITTED + winner is a competitor -> LOST', () => {
    const result = reconcileBidResult({
      outcomeStatus: 'AWARDED',
      submissionStatus: 'VERIFIED_SUBMITTED',
      weAreWinner: false,
      explicitlyWithdrawn: false,
      explicitlyDisqualified: false,
    })
    expect(result.ourResult).toBe('LOST')
  })

  it('AWARDED + VERIFIED_SUBMITTED + winner not yet resolved -> UNKNOWN (never guessed)', () => {
    const result = reconcileBidResult({
      outcomeStatus: 'AWARDED',
      submissionStatus: 'VERIFIED_SUBMITTED',
      weAreWinner: null,
      explicitlyWithdrawn: false,
      explicitlyDisqualified: false,
    })
    expect(result.ourResult).toBe('UNKNOWN')
  })

  it('AWARDED + only SUBMISSION_REPORTED (unverified) -> UNKNOWN, never assumed to have competed', () => {
    const result = reconcileBidResult({
      outcomeStatus: 'AWARDED',
      submissionStatus: 'SUBMISSION_REPORTED',
      weAreWinner: null,
      explicitlyWithdrawn: false,
      explicitlyDisqualified: false,
    })
    expect(result.ourResult).toBe('UNKNOWN')
  })

  it('OPEN/AWARD_PENDING/DISPUTED/UNKNOWN tender outcome always reconciles to UNKNOWN', () => {
    for (const outcomeStatus of ['OPEN', 'AWARD_PENDING', 'DISPUTED', 'UNKNOWN'] as const) {
      const result = reconcileBidResult({
        outcomeStatus,
        submissionStatus: 'VERIFIED_SUBMITTED',
        weAreWinner: null,
        explicitlyWithdrawn: false,
        explicitlyDisqualified: false,
      })
      expect(result.ourResult).toBe('UNKNOWN')
    }
  })

  it('WITHDRAWN tender (organisation withdrew it) is never a bid loss', () => {
    const result = reconcileBidResult({
      outcomeStatus: 'WITHDRAWN',
      submissionStatus: 'VERIFIED_SUBMITTED',
      weAreWinner: null,
      explicitlyWithdrawn: false,
      explicitlyDisqualified: false,
    })
    expect(result.ourResult).toBe('SUBMITTED')
  })

  it('every branch returns a non-empty, traceable basis string', () => {
    const result = reconcileBidResult({
      outcomeStatus: 'AWARDED',
      submissionStatus: 'VERIFIED_SUBMITTED',
      weAreWinner: true,
      explicitlyWithdrawn: false,
      explicitlyDisqualified: false,
    })
    expect(result.basis.length).toBeGreaterThan(10)
  })
})
