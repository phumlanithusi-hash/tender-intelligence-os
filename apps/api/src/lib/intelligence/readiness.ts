import {
  MAX_DUPLICATE_RATE,
  MIN_CLASS_SAMPLE_SIZE,
  MIN_DATASET_SAMPLE_SIZE,
  MIN_FEATURE_COMPLETENESS,
  MIN_MINORITY_CLASS_FRACTION,
} from '@tender-os/constants'
import type { DatasetReadinessInput, DatasetReadinessResult, DecisionTimeObservation, LeakageCheckInput, LeakageCheckResult } from './types.js'

/**
 * Phase 18 §3/§5/§6/§8/§25 — the data-readiness and leakage-protection
 * gate this whole phase is built around. `computeDatasetReadiness` is
 * deliberately conservative: it is fully expected, and correct, for
 * this to return INSUFFICIENT_DATA against the real system's current
 * verified-outcome volume (see docs/PREDICTIVE-INTELLIGENCE.md §3).
 */

const FORBIDDEN_RAW_KEYS = ['awardValue', 'winner', 'winnerName', 'lossReasonPrimary', 'winningScore', 'outcome', 'submissionSuccess']

/**
 * Runtime leakage guard mirroring Phase 17's assertNoOutcomeLeakage —
 * throws if a raw (untyped) feature source object carries any
 * post-outcome key. Every observation entering this engine must have
 * already passed through Phase 17's buildDecisionTimeFeatures, but
 * this is checked again here defensively (spec §5 "a model that
 * performs well because of leakage is FAILED" — so the guard is never
 * relied on only once).
 */
export function assertNoOutcomeLeakageInFeatureSource(raw: Record<string, unknown>): void {
  for (const forbidden of FORBIDDEN_RAW_KEYS) {
    if (forbidden in raw) {
      throw new Error(`Phase 18 §5/§25 data-leakage violation: a decision-time observation may never carry "${forbidden}".`)
    }
  }
}

/**
 * Checks one observation's feature provenance for temporal leakage
 * (spec §5/§6): every feature must come from a stored snapshot (never
 * reconstructed from today's live tables) and no feature timestamp may
 * be after the decision timestamp.
 */
export function checkLeakage(input: LeakageCheckInput): LeakageCheckResult {
  const findings: string[] = []
  if (!input.fromStoredSnapshot) {
    findings.push('Feature values were not sourced from an immutable stored decision-time snapshot (spec §6) — reconstruction from live tables risks using information not actually available at decision time.')
  }
  const decisionTime = new Date(input.decisionTimestamp).getTime()
  for (const ts of input.featureTimestamps) {
    if (new Date(ts).getTime() > decisionTime) {
      findings.push(`A feature/evidence timestamp (${ts}) is after the decision timestamp (${input.decisionTimestamp}) — excluded per spec §5/§80 temporal integrity.`)
    }
  }
  for (const forbidden of FORBIDDEN_RAW_KEYS) {
    if (input.rawKeys.includes(forbidden)) {
      findings.push(`Raw feature source carries the outcome-only field "${forbidden}" — structurally forbidden in a decision-time observation (spec §5/§25).`)
    }
  }
  return { passed: findings.length === 0, findings }
}

function featureCompletenessOf(o: DecisionTimeObservation): number {
  const fields = [
    o.tenderCategory,
    o.province,
    o.estimatedValueBand,
    o.opportunityScoreAtDecision,
    o.requirementCoverageAtDecision,
    o.evidenceStrengthAtDecision,
    o.commercialFitAtDecision,
    o.strategicFitAtDecision,
    o.qualificationStatusAtDecision,
    o.bidEffort,
  ]
  const present = fields.filter((f) => f !== null && f !== undefined).length
  return present / fields.length
}

/**
 * The single deterministic dataset-eligibility gate (spec §3/§8). Runs
 * every check in a fixed, documented order and returns the FIRST
 * blocking state — a dataset is never silently upgraded past a failed
 * check. Thresholds are the documented constants in
 * shared/constants/src/intelligence.ts, never inline magic numbers.
 */
export function computeDatasetReadiness(input: DatasetReadinessInput): DatasetReadinessResult {
  const totalCandidateRecords = input.observations.length
  const labelled = input.observations.filter((o) => o.label !== null)
  const verifiedLabelledRecords = labelled.length
  const positiveCount = labelled.filter((o) => o.label === true).length
  const negativeCount = labelled.filter((o) => o.label === false).length
  const classBalance = verifiedLabelledRecords > 0 ? positiveCount / verifiedLabelledRecords : null

  const completenessScores = labelled.map(featureCompletenessOf)
  const featureCompleteness = completenessScores.length > 0 ? completenessScores.reduce((a, b) => a + b, 0) / completenessScores.length : 0

  const timestamps = labelled.map((o) => new Date(o.decisionTimestamp).getTime()).filter((t) => !Number.isNaN(t))
  const temporalCoverageStart = timestamps.length > 0 ? new Date(Math.min(...timestamps)).toISOString() : null
  const temporalCoverageEnd = timestamps.length > 0 ? new Date(Math.max(...timestamps)).toISOString() : null

  const duplicateRate = totalCandidateRecords > 0 ? input.duplicateRecordCount / totalCandidateRecords : 0

  // Leakage: every observation must have a decision timestamp not in
  // the future relative to `now`, and no observation may exceed the
  // (structurally impossible, but defensively checked) forbidden keys.
  const leakageFindings: string[] = []
  const now = new Date(input.now).getTime()
  for (const o of labelled) {
    const decisionTime = new Date(o.decisionTimestamp).getTime()
    if (decisionTime > now) {
      leakageFindings.push(`Observation ${o.bidProjectId} has a decision timestamp in the future relative to the dataset generation time.`)
    }
  }
  const leakageCheckPassed = leakageFindings.length === 0

  const reasons: string[] = []
  let eligibilityState: DatasetReadinessResult['eligibilityState']

  if (!leakageCheckPassed) {
    eligibilityState = 'LEAKAGE_DETECTED'
    reasons.push(...leakageFindings)
  } else if (verifiedLabelledRecords < MIN_DATASET_SAMPLE_SIZE) {
    eligibilityState = 'INSUFFICIENT_DATA'
    reasons.push(
      `Only ${verifiedLabelledRecords} verified, labelled, decision-time-complete observation(s) exist; a minimum of ${MIN_DATASET_SAMPLE_SIZE} is required before any model training may be attempted (spec §3/§8).`,
    )
  } else if (positiveCount < MIN_CLASS_SAMPLE_SIZE || negativeCount < MIN_CLASS_SAMPLE_SIZE) {
    eligibilityState = 'INSUFFICIENT_LABELS'
    reasons.push(
      `At least ${MIN_CLASS_SAMPLE_SIZE} observations of EACH class are required (currently ${positiveCount} positive / ${negativeCount} negative).`,
    )
  } else if (verifiedLabelledRecords > 0 && Math.min(positiveCount, negativeCount) / verifiedLabelledRecords < MIN_MINORITY_CLASS_FRACTION) {
    const minorityFraction = Math.min(positiveCount, negativeCount) / verifiedLabelledRecords
    eligibilityState = 'HIGH_CLASS_IMBALANCE'
    reasons.push(`Minority-class fraction is ${(minorityFraction * 100).toFixed(1)}%, below the ${(MIN_MINORITY_CLASS_FRACTION * 100).toFixed(0)}% floor this system requires before training (spec §8).`)
  } else if (duplicateRate > MAX_DUPLICATE_RATE) {
    eligibilityState = 'INSUFFICIENT_DATA'
    reasons.push(`Duplicate observation rate (${(duplicateRate * 100).toFixed(1)}%) exceeds the ${(MAX_DUPLICATE_RATE * 100).toFixed(0)}% ceiling.`)
  } else if (featureCompleteness < MIN_FEATURE_COMPLETENESS) {
    eligibilityState = 'INSUFFICIENT_VARIATION'
    reasons.push(`Decision-time feature completeness is ${(featureCompleteness * 100).toFixed(1)}%, below the ${(MIN_FEATURE_COMPLETENESS * 100).toFixed(0)}% floor required to train reliably.`)
  } else {
    eligibilityState = 'READY_FOR_TRAINING'
    reasons.push('All dataset-eligibility checks passed: sufficient sample size, sufficient per-class sample size, acceptable class balance, acceptable duplicate rate, acceptable feature completeness, no leakage findings.')
  }

  return {
    totalCandidateRecords,
    verifiedLabelledRecords,
    positiveCount,
    negativeCount,
    classBalance,
    featureCompleteness,
    temporalCoverageStart,
    temporalCoverageEnd,
    duplicateRate,
    leakageCheckPassed,
    leakageFindings,
    eligibilityState,
    eligibilityReasons: reasons,
  }
}
