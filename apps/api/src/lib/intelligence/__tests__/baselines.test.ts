import { describe, expect, it } from 'vitest'
import { computeOpportunityScoreBaseline, computePrevalenceBaseline } from '../baselines.js'
import type { DecisionTimeObservation } from '../types.js'

function makeObservation(overrides: Partial<DecisionTimeObservation>): DecisionTimeObservation {
  return {
    bidProjectId: crypto.randomUUID(),
    decisionTimestamp: '2026-01-01T00:00:00.000Z',
    label: null,
    tenderCategory: null,
    province: null,
    estimatedValueBand: null,
    opportunityScoreAtDecision: null,
    requirementCoverageAtDecision: null,
    evidenceStrengthAtDecision: null,
    commercialFitAtDecision: null,
    strategicFitAtDecision: null,
    qualificationStatusAtDecision: null,
    bidEffort: null,
    scoringConfigurationVersionId: null,
    bidPolicyVersionId: null,
    ...overrides,
  }
}

describe('computePrevalenceBaseline (spec §7 Baseline A)', () => {
  it('predicts the constant historical prevalence for every observation', () => {
    const observations = [makeObservation({ label: true }), makeObservation({ label: true }), makeObservation({ label: false }), makeObservation({ label: false })]
    const result = computePrevalenceBaseline(observations)
    expect(result.predictions).toEqual([0.5, 0.5, 0.5, 0.5])
    expect(result.sampleSize).toBe(4)
  })

  it('has AUC of 0.5 (no discriminative power) by construction', () => {
    const observations = [makeObservation({ label: true }), makeObservation({ label: false })]
    const result = computePrevalenceBaseline(observations)
    expect(result.auc).toBe(0.5)
  })

  it('ignores unlabelled observations', () => {
    const observations = [makeObservation({ label: true }), makeObservation({ label: null })]
    const result = computePrevalenceBaseline(observations)
    expect(result.sampleSize).toBe(1)
  })
})

describe('computeOpportunityScoreBaseline (spec §7 Baseline B)', () => {
  it('uses the Opportunity Score at decision time, normalised to [0,1], as the prediction', () => {
    const observations = [makeObservation({ label: true, opportunityScoreAtDecision: 90 }), makeObservation({ label: false, opportunityScoreAtDecision: 10 })]
    const result = computeOpportunityScoreBaseline(observations)
    expect(result.predictions).toEqual([0.9, 0.1])
    expect(result.auc).toBe(1)
  })

  it('excludes observations with no recorded Opportunity Score', () => {
    const observations = [makeObservation({ label: true, opportunityScoreAtDecision: 80 }), makeObservation({ label: false, opportunityScoreAtDecision: null })]
    const result = computeOpportunityScoreBaseline(observations)
    expect(result.sampleSize).toBe(1)
  })
})
