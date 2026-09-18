import type { OpportunityScoreDimension, OpportunityDecisionSignal } from '@tender-os/constants'
import type { ScoringConfiguration, ScoredComponent, ScoredGate } from './types.js'

/**
 * Completeness (Phase 10 §22/§23) — the fraction of TOTAL configured
 * dimension weight actually backed by a KNOWN component score. Reported
 * and used entirely separately from the numeric score itself; never
 * called "accuracy" or "confidence".
 */
export function computeDataCompleteness(components: ScoredComponent[]): { knownWeight: number; totalWeight: number; dataCompleteness: number } {
  const totalWeight = components.reduce((s, c) => s + c.weight, 0)
  const knownWeight = components.filter((c) => c.status === 'KNOWN').reduce((s, c) => s + c.weight, 0)
  return { knownWeight, totalWeight, dataCompleteness: totalWeight === 0 ? 0 : knownWeight / totalWeight }
}

/**
 * Overall score (Phase 10 §21): Σ(componentScore × weight) renormalised
 * by the combined weight of only the KNOWN components — this is the
 * documented mechanism by which UNKNOWN is "accounted for" (§22) rather
 * than silently treated as 0 (which would drag the score down for
 * reasons having nothing to do with opportunity quality) or as perfect
 * (which would hide missing information). Data completeness (see above)
 * is what tells the reader how much of the score is actually backed by
 * data. `null` only when NO dimension is known at all.
 */
export function computeOverallScore(components: ScoredComponent[]): number | null {
  const known = components.filter((c) => c.status === 'KNOWN' && c.score !== null)
  const knownWeight = known.reduce((s, c) => s + c.weight, 0)
  if (knownWeight === 0) return null
  const numerator = known.reduce((s, c) => s + c.score! * c.weight, 0)
  return Math.round((numerator / knownWeight) * 100) / 100
}

/**
 * Decision signal precedence (Phase 10 §24, exact order — documented
 * here and in docs/SCORING-ENGINE.md, must never be reordered without
 * updating both):
 *   1. Any hard gate TRIGGERED -> BLOCKED (this also covers
 *      SUBMISSION_DEADLINE_PASSED, folding the "closed tender" case into
 *      the gate layer per §30).
 *   2. Data completeness below the configured threshold -> INSUFFICIENT_DATA.
 *   3. Any dimension the configuration marks `criticalDimensions` is
 *      itself UNKNOWN -> INSUFFICIENT_DATA, even if overall completeness
 *      clears the threshold.
 *   4. overallScore is null (should be unreachable once completeness > 0,
 *      kept as a defensive fallback) -> INSUFFICIENT_DATA.
 *   5. Band lookup against `config.decisionBands` using overallScore.
 */
export function computeDecisionSignal(
  overallScore: number | null,
  dataCompleteness: number,
  components: ScoredComponent[],
  gates: ScoredGate[],
  config: ScoringConfiguration,
): OpportunityDecisionSignal {
  if (gates.some((g) => g.status === 'TRIGGERED')) return 'BLOCKED'
  if (dataCompleteness < config.dataCompletenessInsufficientThreshold) return 'INSUFFICIENT_DATA'
  const criticalUnknown = config.criticalDimensions.some((d: OpportunityScoreDimension) => components.find((c) => c.dimension === d)?.status === 'UNKNOWN')
  if (criticalUnknown) return 'INSUFFICIENT_DATA'
  if (overallScore === null) return 'INSUFFICIENT_DATA'
  const band = config.decisionBands.find((b) => overallScore >= b.min && overallScore <= b.max)
  return band?.signal ?? 'INSUFFICIENT_DATA'
}
