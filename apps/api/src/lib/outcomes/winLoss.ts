import { MIN_MEANINGFUL_SAMPLE_SIZE } from '@tender-os/constants'
import { rateWithCompleteness } from './metrics.js'
import { sampleSizeCaveat } from './provenance.js'
import type { CalibrationOutcome, CalibrationRow, GroupedMetricRow, OutcomeFunnelInput, OutcomeFunnelStage } from './types.js'

/**
 * Phase 17 §30/§31/§34/§35/§36/§50 — the win/loss funnel and grouped
 * (category/organisation/etc.) performance tables. Grouping never
 * silently hides a small sample; it is returned WITH a caveat instead
 * of being upgraded to a "strongest category" claim (spec §31/§33).
 */
export function buildOutcomeFunnel(input: OutcomeFunnelInput): OutcomeFunnelStage[] {
  const base = input.opportunities
  const pct = (n: number): number | null => (base > 0 ? (n / base) * 100 : null)
  return [
    { stage: 'Opportunities', count: input.opportunities, percentOfOpportunities: pct(input.opportunities) },
    { stage: 'Qualified', count: input.qualified, percentOfOpportunities: pct(input.qualified) },
    { stage: 'Bid', count: input.bid, percentOfOpportunities: pct(input.bid) },
    { stage: 'Submitted', count: input.submitted, percentOfOpportunities: pct(input.submitted) },
    { stage: 'Outcome Known', count: input.outcomeKnown, percentOfOpportunities: pct(input.outcomeKnown) },
    { stage: 'Won', count: input.won, percentOfOpportunities: pct(input.won) },
  ]
}

/**
 * Grouped win-rate by an arbitrary key (category, organisation,
 * province, value band, ...). Each row's `sampleSize` and the
 * caveat text returned by `sampleSizeCaveat` MUST be shown alongside
 * any win-rate the UI renders (spec §31).
 */
export function buildGroupedWinRate(groups: Record<string, { won: number; verifiedSubmitted: number }>): GroupedMetricRow[] {
  return Object.entries(groups).map(([groupKey, { won, verifiedSubmitted }]) => ({
    groupKey,
    winRate: rateWithCompleteness(won, verifiedSubmitted, verifiedSubmitted),
    sampleSize: verifiedSubmitted,
  }))
}

export function groupedMetricCaveat(row: GroupedMetricRow): string | null {
  return sampleSizeCaveat(row.sampleSize)
}

/**
 * Bid/no-bid calibration (spec §34/§36) — a NO_BID decision can never
 * be scored as a loss; its counterfactual is always
 * COUNTERFACTUAL_UNKNOWN (we never bid, so we never learn what would
 * have happened) unless a later award was independently observed, in
 * which case the caller may pass that observed outcome in explicitly.
 */
export function calibrationOutcomeForDecision(
  systemDecision: 'BID' | 'PRIORITY_BID' | 'CONDITIONAL' | 'REVIEW' | 'NO_BID' | 'UNDECIDED',
  actualBidResult: 'WON' | 'LOST' | 'DISQUALIFIED' | 'UNKNOWN' | null,
): CalibrationOutcome {
  if (systemDecision === 'NO_BID') return 'COUNTERFACTUAL_UNKNOWN'
  if (!actualBidResult) return 'UNKNOWN'
  return actualBidResult
}

export function buildCalibrationTable(
  rows: Array<{ systemDecision: string; outcome: CalibrationOutcome }>,
): CalibrationRow[] {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const key = `${row.systemDecision}::${row.outcome}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()].map(([key, count]) => {
    const [systemDecision = 'UNKNOWN', outcome = 'UNKNOWN'] = key.split('::')
    return { systemDecision, outcome: outcome as CalibrationOutcome, count }
  })
}

export const MIN_SAMPLE = MIN_MEANINGFUL_SAMPLE_SIZE
