import { computeAUC } from './evaluation.js'
import type { BaselineResult, DecisionTimeObservation } from './types.js'

/**
 * Phase 18 §7 — deterministic baselines computed BEFORE any model is
 * ever considered. A candidate model must beat both of these
 * (spec §7/§19 MIN_AUC_IMPROVEMENT_OVER_BASELINE) or it is not shown
 * to a human approver as production-eligible.
 */

/**
 * Baseline A — the historical class prevalence (spec §7). Every
 * observation is "predicted" at the same constant probability (the
 * observed WON rate), so by construction it has no discriminative
 * power (AUC = 0.5 up to sampling noise) — it exists purely as the
 * "a model must beat pure guessing" floor.
 */
export function computePrevalenceBaseline(observations: DecisionTimeObservation[]): BaselineResult {
  const labelled = observations.filter((o) => o.label !== null)
  const labels = labelled.map((o) => o.label as boolean)
  const prevalence = labels.length > 0 ? labels.filter(Boolean).length / labels.length : 0
  const predictions = labels.map(() => prevalence)
  return {
    type: 'PREVALENCE',
    sampleSize: labels.length,
    auc: computeAUC(predictions, labels),
    predictions,
    labels,
  }
}

/**
 * Baseline B — does the EXISTING Opportunity Score (Phase 10) already
 * separate observed outcomes (spec §7)? Uses the score at decision
 * time (0-100), normalised to [0,1], directly as the "predicted
 * probability" — this is a retrospective analysis of an existing
 * system, never a new score.
 */
export function computeOpportunityScoreBaseline(observations: DecisionTimeObservation[]): BaselineResult {
  const labelled = observations.filter((o) => o.label !== null && o.opportunityScoreAtDecision !== null)
  const labels = labelled.map((o) => o.label as boolean)
  const predictions = labelled.map((o) => Math.min(1, Math.max(0, (o.opportunityScoreAtDecision as number) / 100)))
  return {
    type: 'OPPORTUNITY_SCORE',
    sampleSize: labels.length,
    auc: computeAUC(predictions, labels),
    predictions,
    labels,
  }
}
