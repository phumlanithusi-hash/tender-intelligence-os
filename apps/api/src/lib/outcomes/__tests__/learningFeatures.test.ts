import { describe, expect, it } from 'vitest'
import {
  assertNoOutcomeLeakage,
  buildDecisionTimeFeatures,
  buildLearningStatement,
  buildOutcomeFeatures,
  computeLearningReadiness,
  filterEvidenceAvailableAtDecision,
} from '../learningFeatures.js'

const validDecisionRaw = {
  bidProjectId: 'p1',
  tenderCategory: 'IT Services',
  organisationType: 'MUNICIPAL',
  province: 'Gauteng',
  estimatedValueAtDecision: 2_000_000,
  qualificationStatusAtDecision: 'PASS',
  requirementCoverageAtDecision: 0.9,
  evaluationFitAtDecision: 0.8,
  evidenceStrengthAtDecision: 0.7,
  commercialFitAtDecision: 0.6,
  strategicFitAtDecision: 0.75,
  opportunityScoreAtDecision: 72,
  bidEffort: 'MEDIUM',
  bidDecision: 'BID',
  submissionMethod: 'PORTAL',
}

describe('buildDecisionTimeFeatures / assertNoOutcomeLeakage (Phase 17 §78/§79 — mandatory data-leakage protection)', () => {
  it('builds a decision-time feature snapshot from clean input', () => {
    const features = buildDecisionTimeFeatures(validDecisionRaw)
    expect(features.bidProjectId).toBe('p1')
    expect(features.estimatedValueBand).toBe('R1M_5M')
  })

  it('throws if the raw object carries an outcome-only field (awardValue)', () => {
    const tainted = { ...validDecisionRaw, awardValue: 500_000 }
    expect(() => assertNoOutcomeLeakage(tainted)).toThrow(/data-leakage/)
    expect(() => buildDecisionTimeFeatures(tainted as never)).toThrow(/data-leakage/)
  })

  it('throws if the raw object carries winningScore, lossReasonPrimary, or outcome', () => {
    expect(() => assertNoOutcomeLeakage({ ...validDecisionRaw, winningScore: 80 })).toThrow()
    expect(() => assertNoOutcomeLeakage({ ...validDecisionRaw, lossReasonPrimary: 'PRICE' })).toThrow()
    expect(() => assertNoOutcomeLeakage({ ...validDecisionRaw, outcome: 'LOST' })).toThrow()
  })

  it('the DecisionTimeFeatures type produced never has an awardValue/winner key at all', () => {
    const features = buildDecisionTimeFeatures(validDecisionRaw)
    expect('awardValue' in features).toBe(false)
    expect('winner' in features).toBe(false)
    expect('winningScore' in features).toBe(false)
  })
})

describe('buildOutcomeFeatures — the ONLY place post-outcome facts may live', () => {
  it('carries award value / loss reason / winning score, which decision-time features never do', () => {
    const outcome = buildOutcomeFeatures({
      bidProjectId: 'p1',
      submissionSuccess: true,
      outcome: 'LOST',
      lossReasonPrimary: 'PRICE',
      awardValue: 500_000,
      winningScore: 88,
    })
    expect(outcome.awardValue).toBe(500_000)
    expect(outcome.lossReasonPrimary).toBe('PRICE')
  })
})

describe('filterEvidenceAvailableAtDecision (Phase 17 §80 temporal integrity)', () => {
  it('excludes evidence created after the decision timestamp', () => {
    const result = filterEvidenceAvailableAtDecision('2026-06-01T00:00:00Z', [
      { id: 'cert-early', createdAtIso: '2026-05-01T00:00:00Z' },
      { id: 'cert-late', createdAtIso: '2026-09-01T00:00:00Z' },
    ])
    expect(result.availableAtDecision).toEqual(['cert-early'])
    expect(result.excludedAsFuture).toEqual(['cert-late'])
  })

  it('a certificate added in September must never appear as available for a June decision', () => {
    const result = filterEvidenceAvailableAtDecision('2026-06-15T00:00:00Z', [{ id: 'sept-cert', createdAtIso: '2026-09-15T00:00:00Z' }])
    expect(result.availableAtDecision).toHaveLength(0)
  })
})

describe('computeLearningReadiness (Phase 17 §81)', () => {
  it('never claims the system has learned — only counts', () => {
    const readiness = computeLearningReadiness({ totalBids: 20, verifiedSubmissions: 15, verifiedOutcomes: 10, completeFeatureSnapshots: 12 })
    expect(readiness.learningReadyRecords).toBe(10)
    expect(readiness.readinessNote).toMatch(/not a claim that the system has learned/i)
  })

  it('zero learning-ready records produces an honest zero note', () => {
    const readiness = computeLearningReadiness({ totalBids: 5, verifiedSubmissions: 2, verifiedOutcomes: 0, completeFeatureSnapshots: 3 })
    expect(readiness.learningReadyRecords).toBe(0)
  })
})

describe('buildLearningStatement (Phase 17 §48/§86 — no causal language, no imperative rule changes)', () => {
  it('accepts a properly-hedged OBSERVATION', () => {
    const statement = buildLearningStatement('OBSERVATION', 12, 'Higher evaluation-fit scores are associated with a higher recorded win rate.')
    expect(statement.kind).toBe('OBSERVATION')
  })

  it('rejects causal language even in an OBSERVATION', () => {
    expect(() => buildLearningStatement('OBSERVATION', 12, 'A high score caused these wins.')).toThrow(/causal/)
    expect(() => buildLearningStatement('OBSERVATION', 12, 'This guarantees a win.')).toThrow()
  })

  it('a RECOMMENDATION must be phrased as a suggestion to review, never an imperative change', () => {
    expect(() => buildLearningStatement('RECOMMENDATION', 12, 'Change the evaluation-fit weighting to 35%.')).toThrow(/§48/)
    expect(buildLearningStatement('RECOMMENDATION', 12, 'Consider reviewing the evaluation-fit weighting.').kind).toBe('RECOMMENDATION')
  })

  it('attaches a sample-size caveat for small samples', () => {
    const statement = buildLearningStatement('OBSERVATION', 2, 'Price is recorded in these loss reasons.')
    expect(statement.caveat).toMatch(/too small a sample/i)
  })
})
