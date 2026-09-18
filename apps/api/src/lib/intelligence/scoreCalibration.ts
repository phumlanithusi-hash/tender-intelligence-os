import { MIN_SEGMENT_SAMPLE_SIZE } from '@tender-os/constants'
import { sampleSizeCaveat } from '../outcomes/provenance.js'

/**
 * Phase 18 §15/§16 — retrospective calibration of the EXISTING Phase 10
 * Opportunity Score and Phase 11 Bid/No-Bid decision against Phase 17
 * verified outcomes. Purely descriptive (spec §15 "descriptive unless
 * formally validated") — never writes back into scoring weights or
 * bid-policy thresholds (spec §15/§16/§21).
 */

export const SCORE_BANDS = [
  { key: '0-20', min: 0, max: 20 },
  { key: '20-40', min: 20, max: 40 },
  { key: '40-60', min: 40, max: 60 },
  { key: '60-80', min: 60, max: 80 },
  { key: '80-100', min: 80, max: 100 },
] as const

export interface ScoreBandObservation {
  opportunityScore: number
  won: boolean
  outcomeVerified: boolean
}
export interface ScoreBandResult {
  band: string
  sampleSize: number
  verifiedOutcomeCount: number
  observedWinRate: number | null
  completeness: number | null
  caveat: string | null
}

export function buildOpportunityScoreCalibration(observations: ScoreBandObservation[]): ScoreBandResult[] {
  return SCORE_BANDS.map((band) => {
    const inBand = observations.filter((o) => o.opportunityScore >= band.min && o.opportunityScore < (band.max === 100 ? 101 : band.max))
    const verified = inBand.filter((o) => o.outcomeVerified)
    const won = verified.filter((o) => o.won).length
    const observedWinRate = verified.length > 0 ? won / verified.length : null
    return {
      band: band.key,
      sampleSize: inBand.length,
      verifiedOutcomeCount: verified.length,
      observedWinRate,
      completeness: inBand.length > 0 ? verified.length / inBand.length : null,
      caveat: sampleSizeCaveat(verified.length),
    }
  })
}

/**
 * Bid/No-Bid retrospective: reuses Phase 17's
 * calibrationOutcomeForDecision semantics (a NO_BID decision is never
 * scored as a loss) and adds sample-size-protected segment output
 * (spec §16/§17).
 */
export interface BidNoBidObservation {
  systemDecision: string
  outcome: 'WON' | 'LOST' | 'DISQUALIFIED' | 'COUNTERFACTUAL_UNKNOWN' | 'UNKNOWN'
}
export interface BidNoBidRetrospectiveRow {
  systemDecision: string
  outcome: string
  count: number
  caveat: string | null
}
export function buildBidNoBidRetrospective(observations: BidNoBidObservation[]): BidNoBidRetrospectiveRow[] {
  const counts = new Map<string, number>()
  for (const o of observations) {
    const key = `${o.systemDecision}::${o.outcome}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()].map(([key, count]) => {
    const [systemDecision = 'UNKNOWN', outcome = 'UNKNOWN'] = key.split('::')
    return { systemDecision, outcome, count, caveat: count < MIN_SEGMENT_SAMPLE_SIZE ? sampleSizeCaveat(count) : null }
  })
}
