import type { BidEffortLevel } from '@tender-os/constants'
import type { BidEffortInputs } from './types.js'

/**
 * Phase 11 §24/§25 — deterministic bid-effort formula. Derived ONLY
 * from structured tender characteristics already available from
 * Phase 9 extraction; never an AI judgement, never folded into
 * opportunityScore.
 *
 * Point system (documented here exactly, must not be changed without
 * updating docs/BID-NO-BID-ENGINE.md):
 *   mandatoryDocumentCount:   >=10 -> +2, >=5 -> +1, else +0
 *   evaluationCriteriaCount:  >=8  -> +2, >=4 -> +1, else +0
 *   mandatoryFormCount:       >=10 -> +2, >=5 -> +1, else +0
 *   presentationRequired === true -> +1
 *   briefingCompulsory === true   -> +1
 * Max 8 points. LOW: 0-1, MEDIUM: 2-4, HIGH: 5-8.
 *
 * A `null` presentationRequired/briefingCompulsory contributes 0
 * (documented as "not known to increase effort", never treated as
 * evidence of high effort) — if NOTHING at all is known (every count
 * is 0 and both flags are null), the result is UNKNOWN rather than a
 * confident LOW, so an unpopulated tender is never silently reported
 * as easy to bid.
 */
export function computeBidEffort(inputs: BidEffortInputs): { level: BidEffortLevel; explanation: string; points: number | null } {
  const totallyUnknown = inputs.mandatoryDocumentCount === 0 && inputs.evaluationCriteriaCount === 0 && inputs.mandatoryFormCount === 0 && inputs.presentationRequired === null && inputs.briefingCompulsory === null
  if (totallyUnknown) {
    return { level: 'UNKNOWN', explanation: 'No structured requirement/evaluation-criteria/form data is available yet to estimate bid effort.', points: null }
  }

  let points = 0
  points += inputs.mandatoryDocumentCount >= 10 ? 2 : inputs.mandatoryDocumentCount >= 5 ? 1 : 0
  points += inputs.evaluationCriteriaCount >= 8 ? 2 : inputs.evaluationCriteriaCount >= 4 ? 1 : 0
  points += inputs.mandatoryFormCount >= 10 ? 2 : inputs.mandatoryFormCount >= 5 ? 1 : 0
  points += inputs.presentationRequired === true ? 1 : 0
  points += inputs.briefingCompulsory === true ? 1 : 0

  const level: BidEffortLevel = points >= 5 ? 'HIGH' : points >= 2 ? 'MEDIUM' : 'LOW'
  const explanation = `Bid effort score ${points}/8 (mandatory documents: ${inputs.mandatoryDocumentCount}, evaluation criteria: ${inputs.evaluationCriteriaCount}, mandatory forms: ${inputs.mandatoryFormCount}, presentation required: ${inputs.presentationRequired ?? 'unknown'}, compulsory briefing: ${inputs.briefingCompulsory ?? 'unknown'}) -> ${level}.`
  return { level, explanation, points }
}
