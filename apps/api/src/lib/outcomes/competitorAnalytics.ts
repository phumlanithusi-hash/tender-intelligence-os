import type { CompetitorActivityRecord, CompetitorSummary } from './types.js'

/**
 * Phase 17 §64/§65/§90 — competitor analytics: descriptive counts
 * only, procurement-specific, no speculative "true win rate" unless
 * the underlying dataset genuinely supports one, and no personal or
 * unrelated intelligence of any kind.
 */
export function summarizeCompetitor(competitorId: string, records: CompetitorActivityRecord[]): CompetitorSummary {
  const mine = records.filter((r) => r.competitorId === competitorId)
  const recordedBids = mine.length
  const verifiedWins = mine.filter((r) => r.result === 'WINNER').length
  const verifiedLosses = mine.filter((r) => r.result === 'BIDDER' || r.result === 'DISQUALIFIED' || r.result === 'SHORTLISTED').length

  return {
    competitorId,
    recordedBids,
    verifiedWins,
    verifiedLosses,
    dataQualityCaveat:
      recordedBids === 0
        ? 'No recorded activity for this competitor — absence of data is not evidence of absence from the market.'
        : `${competitorId} appears in ${recordedBids} recorded tender(s) with ${verifiedWins} recorded win(s). This is an observed count, not a market win-rate.`,
  }
}
