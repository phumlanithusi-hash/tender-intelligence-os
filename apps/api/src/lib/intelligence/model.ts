import type { DecisionTimeObservation, LogisticModel } from './types.js'

/**
 * Phase 18 §7 Baseline C — the ONLY non-baseline model type this phase
 * permits: a small, regularised logistic regression over a handful of
 * decision-time numeric features. Deliberately NOT an ensemble or
 * neural model (spec §7 "never a complex ensemble or neural model").
 * Pure, deterministic (fixed seed-free gradient descent — no
 * Math.random anywhere), zero I/O.
 */

const FEATURE_NAMES = ['opportunityScore', 'requirementCoverage', 'evidenceStrength', 'commercialFit', 'strategicFit'] as const

export function extractModelFeatures(o: DecisionTimeObservation): number[] {
  return [
    o.opportunityScoreAtDecision !== null ? o.opportunityScoreAtDecision / 100 : 0.5,
    o.requirementCoverageAtDecision ?? 0.5,
    o.evidenceStrengthAtDecision ?? 0.5,
    o.commercialFitAtDecision ?? 0.5,
    o.strategicFitAtDecision ?? 0.5,
  ]
}

function standardise(matrix: number[][]): { standardised: number[][]; means: number[]; stdDevs: number[] } {
  const featureCount = matrix[0]?.length ?? 0
  const means = new Array(featureCount).fill(0)
  const stdDevs = new Array(featureCount).fill(1)
  for (let f = 0; f < featureCount; f++) {
    const values = matrix.map((row) => row[f]!)
    const mean = values.reduce((a, b) => a + b, 0) / values.length
    const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length
    means[f] = mean
    stdDevs[f] = Math.sqrt(variance) || 1
  }
  const standardised = matrix.map((row) => row.map((v, f) => (v - means[f]!) / stdDevs[f]!))
  return { standardised, means, stdDevs }
}

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z))
}

/**
 * Trains a regularised (L2) logistic regression via batch gradient
 * descent. Deterministic for a given input (weights always initialise
 * to zero — no random seed needed).
 */
export function trainLogisticRegression(
  features: number[][],
  labels: boolean[],
  options: { epochs?: number; learningRate?: number; l2?: number } = {},
): LogisticModel {
  const epochs = options.epochs ?? 500
  const learningRate = options.learningRate ?? 0.1
  const l2 = options.l2 ?? 0.01
  const { standardised, means, stdDevs } = standardise(features)
  const n = standardised.length
  const featureCount = standardised[0]?.length ?? 0
  let weights = new Array(featureCount).fill(0)
  let bias = 0
  const y = labels.map((l) => (l ? 1 : 0))

  for (let epoch = 0; epoch < epochs; epoch++) {
    const gradW = new Array(featureCount).fill(0)
    let gradB = 0
    for (let i = 0; i < n; i++) {
      const z = standardised[i]!.reduce((sum, x, f) => sum + x * weights[f]!, bias)
      const pred = sigmoid(z)
      const error = pred - y[i]!
      for (let f = 0; f < featureCount; f++) gradW[f] += error * standardised[i]![f]!
      gradB += error
    }
    weights = weights.map((w, f) => w - learningRate * (gradW[f] / n + l2 * w))
    bias -= learningRate * (gradB / n)
  }

  return { weights, bias, featureNames: [...FEATURE_NAMES], featureMeans: means, featureStdDevs: stdDevs }
}

export function predictWithLogisticModel(model: LogisticModel, features: number[]): number {
  const standardisedFeatures = features.map((v, f) => (v - model.featureMeans[f]!) / model.featureStdDevs[f]!)
  const z = standardisedFeatures.reduce((sum, x, f) => sum + x * model.weights[f]!, model.bias)
  return sigmoid(z)
}

/** Feature contribution for one prediction, sorted strongest-first —
 * feeds the explanation engine (spec §14). Positive weight*standardised-
 * value pushes the prediction up; negative pushes it down. */
export function featureContributions(model: LogisticModel, features: number[]): Array<{ feature: string; contribution: number }> {
  const standardisedFeatures = features.map((v, f) => (v - model.featureMeans[f]!) / model.featureStdDevs[f]!)
  return model.featureNames
    .map((feature, f) => ({ feature, contribution: standardisedFeatures[f]! * model.weights[f]! }))
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
}
