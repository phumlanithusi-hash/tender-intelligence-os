import { valueBand } from './awardAnalytics.js'
import { assertNoCausalLanguage, sampleSizeCaveat } from './provenance.js'
import { OUTCOME_ONLY_FIELDS } from './types.js'
import type { DecisionTimeFeatures, LearningReadiness, LearningReadinessInput, OutcomeFeatures } from './types.js'

/**
 * Phase 17 §43/§44/§78/§79/§80 — the procurement learning foundation.
 * This module is the data-leakage boundary the whole phase depends on:
 * `buildDecisionTimeFeatures` can only ever read fields that existed
 * BEFORE the outcome was known, and structurally cannot accept an
 * award_value/winner/loss_reason/winning_score field — those live only
 * in `buildOutcomeFeatures`'s separate return type. §47/§48/§87/§88/§89:
 * nothing here writes back into scoring/bid-decision/strategy config,
 * and nothing here computes a "win probability".
 */

export interface DecisionTimeRawInput {
  bidProjectId: string
  tenderCategory: string | null
  organisationType: string | null
  province: string | null
  estimatedValueAtDecision: number | null
  qualificationStatusAtDecision: string | null
  requirementCoverageAtDecision: number | null
  evaluationFitAtDecision: number | null
  evidenceStrengthAtDecision: number | null
  commercialFitAtDecision: number | null
  strategicFitAtDecision: number | null
  opportunityScoreAtDecision: number | null
  bidEffort: string | null
  bidDecision: string | null
  submissionMethod: string | null
}

/**
 * Runtime leakage guard: throws if the raw input object carries any
 * key from OUTCOME_ONLY_FIELDS, so a caller can never accidentally
 * smuggle a post-outcome fact into a decision-time snapshot.
 */
export function assertNoOutcomeLeakage(raw: Record<string, unknown>): void {
  for (const forbidden of OUTCOME_ONLY_FIELDS) {
    if (forbidden in raw) {
      throw new Error(`Phase 17 §79 data-leakage violation: decision-time features may never carry "${forbidden}".`)
    }
  }
}

export function buildDecisionTimeFeatures(raw: DecisionTimeRawInput): DecisionTimeFeatures {
  assertNoOutcomeLeakage(raw as unknown as Record<string, unknown>)
  return {
    bidProjectId: raw.bidProjectId,
    tenderCategory: raw.tenderCategory,
    organisationType: raw.organisationType,
    province: raw.province,
    estimatedValueBand: valueBand(raw.estimatedValueAtDecision).band,
    qualificationStatusAtDecision: raw.qualificationStatusAtDecision,
    requirementCoverageAtDecision: raw.requirementCoverageAtDecision,
    evaluationFitAtDecision: raw.evaluationFitAtDecision,
    evidenceStrengthAtDecision: raw.evidenceStrengthAtDecision,
    commercialFitAtDecision: raw.commercialFitAtDecision,
    strategicFitAtDecision: raw.strategicFitAtDecision,
    opportunityScoreAtDecision: raw.opportunityScoreAtDecision,
    bidEffort: raw.bidEffort,
    bidDecision: raw.bidDecision,
    submissionMethod: raw.submissionMethod,
  }
}

export interface OutcomeRawInput {
  bidProjectId: string
  submissionSuccess: boolean | null
  outcome: OutcomeFeatures['outcome']
  lossReasonPrimary: OutcomeFeatures['lossReasonPrimary']
  awardValue: number | null
  winningScore: number | null
}

export function buildOutcomeFeatures(raw: OutcomeRawInput): OutcomeFeatures {
  return { ...raw }
}

/**
 * Temporal integrity (spec §80): a piece of evidence/certificate dated
 * AFTER the decision timestamp must never be treated as "available at
 * the time of the decision". Returns the subset that genuinely
 * qualifies, plus the excluded (future-dated) ones for transparency.
 */
export function filterEvidenceAvailableAtDecision(
  decisionIso: string,
  evidence: Array<{ id: string; createdAtIso: string }>,
): { availableAtDecision: string[]; excludedAsFuture: string[] } {
  const decisionTime = new Date(decisionIso).getTime()
  const availableAtDecision: string[] = []
  const excludedAsFuture: string[] = []
  for (const item of evidence) {
    const created = new Date(item.createdAtIso).getTime()
    if (created <= decisionTime) availableAtDecision.push(item.id)
    else excludedAsFuture.push(item.id)
  }
  return { availableAtDecision, excludedAsFuture }
}

/**
 * Learning readiness (spec §81) — a plain count, never framed as "the
 * AI has learned".
 */
export function computeLearningReadiness(input: LearningReadinessInput): LearningReadiness {
  const learningReadyRecords = Math.min(input.verifiedOutcomes, input.completeFeatureSnapshots)
  return {
    ...input,
    learningReadyRecords,
    readinessNote:
      learningReadyRecords === 0
        ? 'No records are yet complete enough to learn from (a learning-ready record requires both a verified outcome and a complete decision-time feature snapshot).'
        : `${learningReadyRecords} record(s) currently have both a verified outcome and a complete decision-time snapshot — this is a readiness count, not a claim that the system has learned anything.`,
  }
}

export type ObservationKind = 'OBSERVATION' | 'RECOMMENDATION'

/**
 * Phase 17 §48/§86 — every learning-layer statement must be labelled
 * OBSERVATION or RECOMMENDATION and must never use causal/imperative
 * language ("change to 35%"); this is the single choke point all such
 * text passes through.
 */
export function buildLearningStatement(kind: ObservationKind, sampleSize: number, text: string): { kind: ObservationKind; text: string; caveat: string | null } {
  assertNoCausalLanguage(text)
  if (kind === 'RECOMMENDATION' && !/consider|review|worth examining/i.test(text)) {
    throw new Error('Phase 17 §48 violation: a RECOMMENDATION must be phrased as a suggestion to review, never an imperative rule change.')
  }
  return { kind, text, caveat: sampleSizeCaveat(sampleSize) }
}
