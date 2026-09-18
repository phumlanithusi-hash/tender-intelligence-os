import { describe, expect, it } from 'vitest'
import { computeAUC } from '../evaluation.js'
import { extractModelFeatures, featureContributions, predictWithLogisticModel, trainLogisticRegression } from '../model.js'
import type { DecisionTimeObservation } from '../types.js'

function makeObservation(score: number, label: boolean): DecisionTimeObservation {
  return {
    bidProjectId: crypto.randomUUID(),
    decisionTimestamp: '2026-01-01T00:00:00.000Z',
    label,
    tenderCategory: null,
    province: null,
    estimatedValueBand: null,
    opportunityScoreAtDecision: score,
    requirementCoverageAtDecision: score / 100,
    evidenceStrengthAtDecision: score / 100,
    commercialFitAtDecision: 0.5,
    strategicFitAtDecision: 0.5,
    qualificationStatusAtDecision: null,
    bidEffort: null,
    scoringConfigurationVersionId: null,
    bidPolicyVersionId: null,
  }
}

describe('trainLogisticRegression / predictWithLogisticModel (spec §7 Baseline C)', () => {
  it('is deterministic — training twice on the same data yields the same weights', () => {
    const features = [
      [1, 1, 1, 1, 1],
      [0, 0, 0, 0, 0],
    ]
    const labels = [true, false]
    const modelA = trainLogisticRegression(features, labels)
    const modelB = trainLogisticRegression(features, labels)
    expect(modelA.weights).toEqual(modelB.weights)
    expect(modelA.bias).toEqual(modelB.bias)
  })

  it('learns to separate a clearly separable synthetic dataset (fixture data, never presented as production)', () => {
    const won = Array.from({ length: 20 }, (_, i) => makeObservation(80 + i % 10, true))
    const lost = Array.from({ length: 20 }, (_, i) => makeObservation(10 + i % 10, false))
    const observations = [...won, ...lost]
    const features = observations.map(extractModelFeatures)
    const labels = observations.map((o) => o.label as boolean)
    const model = trainLogisticRegression(features, labels, { epochs: 400 })
    const predictions = features.map((f) => predictWithLogisticModel(model, f))
    const auc = computeAUC(predictions, labels)
    expect(auc).not.toBeNull()
    expect(auc!).toBeGreaterThan(0.8)
  })

  it('produces probabilities strictly between 0 and 1', () => {
    const model = trainLogisticRegression(
      [
        [1, 1, 1, 1, 1],
        [0, 0, 0, 0, 0],
      ],
      [true, false],
    )
    const p = predictWithLogisticModel(model, [0.5, 0.5, 0.5, 0.5, 0.5])
    expect(p).toBeGreaterThan(0)
    expect(p).toBeLessThan(1)
  })
})

describe('featureContributions (spec §14 explainability)', () => {
  it('sorts contributions by absolute magnitude, strongest first', () => {
    const model = {
      weights: [2, -1, 0.1, 0, 0],
      bias: 0,
      featureNames: ['opportunityScore', 'requirementCoverage', 'evidenceStrength', 'commercialFit', 'strategicFit'],
      featureMeans: [0.5, 0.5, 0.5, 0.5, 0.5],
      featureStdDevs: [0.2, 0.2, 0.2, 0.2, 0.2],
    }
    const contributions = featureContributions(model, [0.9, 0.1, 0.5, 0.5, 0.5])
    expect(contributions[0]!.feature).toBe('opportunityScore')
    expect(Math.abs(contributions[0]!.contribution)).toBeGreaterThanOrEqual(Math.abs(contributions[1]!.contribution))
  })
})
