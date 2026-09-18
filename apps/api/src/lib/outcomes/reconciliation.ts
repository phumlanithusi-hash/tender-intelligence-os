import type { ReconciliationInput, ReconciliationResult } from './types.js'

/**
 * Phase 17 §24 — bid/outcome reconciliation. Deterministic, total
 * (every branch produces a result), and structured so that
 * NOT_SUBMITTED, WITHDRAWN and UNKNOWN can never be silently promoted
 * to LOST (spec §23/§25/§26/§106).
 *
 * Precedence (checked in this fixed order):
 *   1. explicit withdrawal always wins  -> WITHDRAWN
 *   2. explicit disqualification        -> DISQUALIFIED
 *   3. we did not submit                -> NOT_SUBMITTED (never LOST)
 *   4. tender outcome not yet known / disputed -> UNKNOWN
 *   5. tender CANCELLED or NO_AWARD      -> submission-dependent, never LOST
 *   6. tender AWARDED + verified submission + we are winner -> WON
 *   7. tender AWARDED + verified submission + winner known, not us -> LOST
 *   8. tender AWARDED + only "reported" (unverified) submission -> UNKNOWN
 *      (never assume we competed — spec §23)
 *   9. otherwise -> UNKNOWN
 */
export function reconcileBidResult(input: ReconciliationInput): ReconciliationResult {
  const { outcomeStatus, submissionStatus, weAreWinner, explicitlyWithdrawn, explicitlyDisqualified } = input

  if (explicitlyWithdrawn) {
    return { ourResult: 'WITHDRAWN', basis: 'Human-recorded withdrawal takes precedence over any tender outcome.' }
  }

  if (explicitlyDisqualified) {
    return { ourResult: 'DISQUALIFIED', basis: 'Disqualification recorded from official/human source; not treated as an ordinary loss.' }
  }

  if (submissionStatus === 'NOT_SUBMITTED') {
    return { ourResult: 'NOT_SUBMITTED', basis: 'No verified or reported submission exists for this bid — never reclassified as LOST regardless of tender outcome.' }
  }

  if (outcomeStatus === 'UNKNOWN' || outcomeStatus === 'DISPUTED' || outcomeStatus === 'OPEN' || outcomeStatus === 'AWARD_PENDING') {
    return { ourResult: 'UNKNOWN', basis: `Tender outcome is ${outcomeStatus} — no result can be reconciled yet.` }
  }

  if (outcomeStatus === 'CANCELLED' || outcomeStatus === 'NO_AWARD') {
    if (submissionStatus === 'VERIFIED_SUBMITTED' || submissionStatus === 'SUBMISSION_REPORTED') {
      return { ourResult: 'SUBMITTED', basis: `Tender ${outcomeStatus.replace('_', ' ').toLowerCase()} after our submission — no award was made, so this is never counted as a loss (spec §26).` }
    }
    return { ourResult: 'UNKNOWN', basis: `Tender ${outcomeStatus} with an unresolved submission status.` }
  }

  if (outcomeStatus === 'WITHDRAWN') {
    return { ourResult: submissionStatus === 'VERIFIED_SUBMITTED' ? 'SUBMITTED' : 'UNKNOWN', basis: 'Tender itself was withdrawn by the organisation — not a bid loss.' }
  }

  // outcomeStatus === 'AWARDED'
  if (submissionStatus === 'VERIFIED_SUBMITTED') {
    if (weAreWinner === true) {
      return { ourResult: 'WON', basis: 'Tender AWARDED, our submission VERIFIED_SUBMITTED, and the recorded winner matches this agency.' }
    }
    if (weAreWinner === false) {
      return { ourResult: 'LOST', basis: 'Tender AWARDED, our submission VERIFIED_SUBMITTED, and the recorded winner is a different entity.' }
    }
    return { ourResult: 'UNKNOWN', basis: 'Tender AWARDED and our submission is VERIFIED_SUBMITTED, but the winner has not yet been resolved against this agency.' }
  }

  // SUBMISSION_REPORTED (unverified) — never assume we actually competed.
  return { ourResult: 'UNKNOWN', basis: 'Tender AWARDED, but our submission is only SUBMISSION_REPORTED (no verified receipt) — outcome kept UNKNOWN rather than assuming participation.' }
}
