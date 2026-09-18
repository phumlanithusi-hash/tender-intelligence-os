import { describe, expect, it } from 'vitest'
import { assertNoOutcomeLeakageInFeatureSource, checkLeakage, computeDatasetReadiness } from '../readiness.js'
import type { DecisionTimeObservation } from '../types.js'

function makeObservation(overrides: Partial<DecisionTimeObservation> = {}): DecisionTimeObservation {
  return {
    bidProjectId: crypto.randomUUID(),
    decisionTimestamp: '2026-01-01T00:00:00.000Z',
    label: true,
    tenderCategory: 'IT_SERVICES',
    province: 'GAUTENG',
    estimatedValueBand: 'R1M_5M',
    opportunityScoreAtDecision: 70,
    requirementCoverageAtDecision: 0.8,
    evidenceStrengthAtDecision: 0.7,
    commercialFitAtDecision: 0.6,
    strategicFitAtDecision: 0.5,
    qualificationStatusAtDecision: 'QUALIFIED',
    bidEffort: 'MEDIUM',
    scoringConfigurationVersionId: null,
    bidPolicyVersionId: null,
    ...overrides,
  }
}

describe('computeDatasetReadiness (Phase 18 §3/§8)', () => {
  it('reports INSUFFICIENT_DATA when there are far fewer than 30 labelled observations (the real-system expected case)', () => {
    const observations = Array.from({ length: 3 }, (_, i) => makeObservation({ label: i % 2 === 0 }))
    const result = computeDatasetReadiness({ observations, duplicateRecordCount: 0, now: '2026-09-12T00:00:00.000Z' })
    expect(result.eligibilityState).toBe('INSUFFICIENT_DATA')
    expect(result.verifiedLabelledRecords).toBe(3)
    expect(result.eligibilityReasons[0]).toMatch(/minimum of 30/)
  })

  it('reports INSUFFICIENT_DATA on a completely empty dataset without throwing', () => {
    const result = computeDatasetReadiness({ observations: [], duplicateRecordCount: 0, now: '2026-09-12T00:00:00.000Z' })
    expect(result.eligibilityState).toBe('INSUFFICIENT_DATA')
    expect(result.totalCandidateRecords).toBe(0)
    expect(result.classBalance).toBeNull()
  })

  it('reports INSUFFICIENT_LABELS when total sample is sufficient but one class has fewer than 10 observations', () => {
    const positives = Array.from({ length: 25 }, () => makeObservation({ label: true }))
    const negatives = Array.from({ length: 5 }, () => makeObservation({ label: false }))
    const result = computeDatasetReadiness({ observations: [...positives, ...negatives], duplicateRecordCount: 0, now: '2026-09-12T00:00:00.000Z' })
    expect(result.eligibilityState).toBe('INSUFFICIENT_LABELS')
  })

  it('reports HIGH_CLASS_IMBALANCE when minority fraction is below 10%', () => {
    const positives = Array.from({ length: 95 }, () => makeObservation({ label: true }))
    const negatives = Array.from({ length: 10 }, () => makeObservation({ label: false }))
    const result = computeDatasetReadiness({ observations: [...positives, ...negatives], duplicateRecordCount: 0, now: '2026-09-12T00:00:00.000Z' })
    expect(result.eligibilityState).toBe('HIGH_CLASS_IMBALANCE')
  })

  it('reports INSUFFICIENT_VARIATION when feature completeness is below 70% even with enough labelled records', () => {
    const observations = Array.from({ length: 60 }, (_, i) =>
      makeObservation({
        label: i % 2 === 0,
        opportunityScoreAtDecision: null,
        requirementCoverageAtDecision: null,
        evidenceStrengthAtDecision: null,
        commercialFitAtDecision: null,
      }),
    )
    const result = computeDatasetReadiness({ observations, duplicateRecordCount: 0, now: '2026-09-12T00:00:00.000Z' })
    expect(result.eligibilityState).toBe('INSUFFICIENT_VARIATION')
  })

  it('reports READY_FOR_TRAINING on a well-formed, sufficient, balanced, complete dataset (test fixture only)', () => {
    const observations = Array.from({ length: 60 }, (_, i) => makeObservation({ label: i % 2 === 0, bidProjectId: `fixture-${i}` }))
    const result = computeDatasetReadiness({ observations, duplicateRecordCount: 0, now: '2026-09-12T00:00:00.000Z' })
    expect(result.eligibilityState).toBe('READY_FOR_TRAINING')
    expect(result.leakageCheckPassed).toBe(true)
  })

  it('reports LEAKAGE_DETECTED when an observation has a future decision timestamp relative to "now"', () => {
    const observations = Array.from({ length: 60 }, (_, i) => makeObservation({ label: i % 2 === 0, decisionTimestamp: i === 0 ? '2099-01-01T00:00:00.000Z' : '2026-01-01T00:00:00.000Z' }))
    const result = computeDatasetReadiness({ observations, duplicateRecordCount: 0, now: '2026-09-12T00:00:00.000Z' })
    expect(result.eligibilityState).toBe('LEAKAGE_DETECTED')
    expect(result.leakageCheckPassed).toBe(false)
  })

  it('flags INSUFFICIENT_DATA when duplicate rate exceeds the ceiling even with an otherwise-sufficient sample', () => {
    const observations = Array.from({ length: 60 }, (_, i) => makeObservation({ label: i % 2 === 0 }))
    const result = computeDatasetReadiness({ observations, duplicateRecordCount: 10, now: '2026-09-12T00:00:00.000Z' })
    expect(result.eligibilityState).toBe('INSUFFICIENT_DATA')
  })

  it('excludes unlabelled observations (label: null) from verifiedLabelledRecords and class counts', () => {
    const observations = [...Array.from({ length: 60 }, (_, i) => makeObservation({ label: i % 2 === 0 })), ...Array.from({ length: 20 }, () => makeObservation({ label: null }))]
    const result = computeDatasetReadiness({ observations, duplicateRecordCount: 0, now: '2026-09-12T00:00:00.000Z' })
    expect(result.totalCandidateRecords).toBe(80)
    expect(result.verifiedLabelledRecords).toBe(60)
  })
})

describe('leakage guards (spec §5/§6/§25)', () => {
  it('assertNoOutcomeLeakageInFeatureSource throws when a raw source carries awardValue', () => {
    expect(() => assertNoOutcomeLeakageInFeatureSource({ awardValue: 100000 })).toThrow(/data-leakage violation/)
  })

  it('assertNoOutcomeLeakageInFeatureSource does not throw for a clean decision-time object', () => {
    expect(() => assertNoOutcomeLeakageInFeatureSource({ opportunityScoreAtDecision: 70 })).not.toThrow()
  })

  it('checkLeakage fails when a feature timestamp is after the decision timestamp', () => {
    const result = checkLeakage({
      decisionTimestamp: '2026-01-01T00:00:00.000Z',
      featureTimestamps: ['2026-01-05T00:00:00.000Z'],
      fromStoredSnapshot: true,
      rawKeys: [],
    })
    expect(result.passed).toBe(false)
    expect(result.findings[0]).toMatch(/after the decision timestamp/)
  })

  it('checkLeakage fails when features were not sourced from a stored snapshot', () => {
    const result = checkLeakage({ decisionTimestamp: '2026-01-01T00:00:00.000Z', featureTimestamps: [], fromStoredSnapshot: false, rawKeys: [] })
    expect(result.passed).toBe(false)
  })

  it('checkLeakage passes for a clean, snapshot-sourced, non-future observation', () => {
    const result = checkLeakage({ decisionTimestamp: '2026-01-01T00:00:00.000Z', featureTimestamps: ['2025-12-01T00:00:00.000Z'], fromStoredSnapshot: true, rawKeys: [] })
    expect(result.passed).toBe(true)
  })

  it('checkLeakage fails when raw keys carry a post-outcome field (award value)', () => {
    const result = checkLeakage({ decisionTimestamp: '2026-01-01T00:00:00.000Z', featureTimestamps: [], fromStoredSnapshot: true, rawKeys: ['awardValue'] })
    expect(result.passed).toBe(false)
  })

  it('checkLeakage fails when raw keys carry the winner field', () => {
    const result = checkLeakage({ decisionTimestamp: '2026-01-01T00:00:00.000Z', featureTimestamps: [], fromStoredSnapshot: true, rawKeys: ['winner'] })
    expect(result.passed).toBe(false)
  })

  it('checkLeakage fails when raw keys carry winningScore', () => {
    const result = checkLeakage({ decisionTimestamp: '2026-01-01T00:00:00.000Z', featureTimestamps: [], fromStoredSnapshot: true, rawKeys: ['winningScore'] })
    expect(result.passed).toBe(false)
  })

  it('checkLeakage fails when raw keys carry lossReasonPrimary', () => {
    const result = checkLeakage({ decisionTimestamp: '2026-01-01T00:00:00.000Z', featureTimestamps: [], fromStoredSnapshot: true, rawKeys: ['lossReasonPrimary'] })
    expect(result.passed).toBe(false)
  })
})
