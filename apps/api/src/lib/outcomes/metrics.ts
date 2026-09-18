import { MIN_MEANINGFUL_SAMPLE_SIZE } from '@tender-os/constants'
import type { CoreMetrics, OutcomeCountsInput, RateWithCompleteness } from './types.js'

/**
 * Phase 17 §27/§28/§29/§31 — deterministic metric functions. Every
 * rate always carries numerator/denominator/completeness and an
 * insufficientSample flag; division by zero always yields `rate: null`,
 * never 0, NaN or Infinity (spec §27: "Never divide by zero").
 */
export function rateWithCompleteness(numerator: number, denominator: number, totalConsidered: number): RateWithCompleteness {
  const rate = denominator > 0 ? numerator / denominator : null
  const completeness = totalConsidered > 0 ? denominator / totalConsidered : null
  return {
    rate,
    numerator,
    denominator,
    completeness,
    insufficientSample: denominator < MIN_MEANINGFUL_SAMPLE_SIZE,
  }
}

export function computeCoreMetrics(counts: OutcomeCountsInput): CoreMetrics {
  const verifiedSubmitted = counts.submittedVerified
  const totalRecorded = counts.won + counts.lost + counts.disqualified + counts.withdrawn + counts.outcomeUnknown + counts.noAward + counts.cancelled

  return {
    submissionRate: rateWithCompleteness(verifiedSubmitted, counts.totalEligibleForSubmission, counts.totalEligibleForSubmission),
    bidRate: rateWithCompleteness(counts.totalBidDecisions, counts.totalQualified, counts.totalQualified),
    winRate: rateWithCompleteness(counts.won, verifiedSubmitted, totalRecorded),
    lossRate: rateWithCompleteness(counts.lost, verifiedSubmitted, totalRecorded),
    disqualificationRate: rateWithCompleteness(counts.disqualified, verifiedSubmitted, totalRecorded),
    withdrawalRate: rateWithCompleteness(counts.withdrawn, counts.totalBidDecisions, counts.totalBidDecisions),
    noAwardRate: rateWithCompleteness(counts.noAward, totalRecorded, totalRecorded),
  }
}
