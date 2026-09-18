import { describe, expect, it } from 'vitest'
import { computeAUC, computeBrierScore, computeConfusionMatrix, computeLogLoss, computePRAUC, computePrecisionRecallF1, evaluatePredictions } from '../evaluation.js'

describe('computeAUC (Phase 18 §10)', () => {
  it('returns 1.0 for perfect separation', () => {
    expect(computeAUC([0.1, 0.2, 0.8, 0.9], [false, false, true, true])).toBe(1)
  })

  it('returns 0.0 for perfectly inverted separation', () => {
    expect(computeAUC([0.9, 0.8, 0.2, 0.1], [false, false, true, true])).toBe(0)
  })

  it('returns 0.5 for a random/uninformative predictor', () => {
    const predictions = [0.5, 0.5, 0.5, 0.5]
    const labels = [true, false, true, false]
    expect(computeAUC(predictions, labels)).toBe(0.5)
  })

  it('returns null when there are no positive examples', () => {
    expect(computeAUC([0.1, 0.2, 0.3], [false, false, false])).toBeNull()
  })

  it('returns null when there are no negative examples', () => {
    expect(computeAUC([0.1, 0.2, 0.3], [true, true, true])).toBeNull()
  })

  it('returns null on an empty dataset', () => {
    expect(computeAUC([], [])).toBeNull()
  })

  it('handles tied scores via averaged ranks', () => {
    // Two positives and two negatives share the same score — AUC
    // should still compute without throwing.
    const auc = computeAUC([0.5, 0.5, 0.5, 0.5], [true, false, true, false])
    expect(auc).toBe(0.5)
  })
})

describe('computePRAUC', () => {
  it('returns close to 1.0 for perfect separation', () => {
    const prAuc = computePRAUC([0.1, 0.2, 0.8, 0.9], [false, false, true, true])
    expect(prAuc).toBeGreaterThan(0.9)
  })

  it('returns null when there are no positives', () => {
    expect(computePRAUC([0.1, 0.2], [false, false])).toBeNull()
  })

  it('returns null on an empty dataset', () => {
    expect(computePRAUC([], [])).toBeNull()
  })
})

describe('computeConfusionMatrix / precision / recall / f1', () => {
  it('computes an exact confusion matrix at threshold 0.5', () => {
    const cm = computeConfusionMatrix([0.9, 0.4, 0.6, 0.1], [true, true, false, false], 0.5)
    expect(cm).toEqual({ truePositive: 1, falsePositive: 1, trueNegative: 1, falseNegative: 1 })
  })

  it('computes precision/recall/f1 consistent with the confusion matrix', () => {
    const { precision, recall, f1 } = computePrecisionRecallF1([0.9, 0.8, 0.2, 0.1], [true, true, false, false], 0.5)
    expect(precision).toBe(1)
    expect(recall).toBe(1)
    expect(f1).toBe(1)
  })

  it('returns null precision when there are no predicted positives', () => {
    const { precision, recall } = computePrecisionRecallF1([0.1, 0.2], [true, false], 0.5)
    expect(precision).toBeNull()
    expect(recall).toBe(0)
  })

  it('returns null confusion matrix on an empty dataset', () => {
    expect(computeConfusionMatrix([], [])).toBeNull()
  })
})

describe('computeBrierScore / computeLogLoss', () => {
  it('computes 0 Brier score for perfect confident predictions', () => {
    expect(computeBrierScore([1, 0], [true, false])).toBe(0)
  })

  it('computes a positive Brier score for imperfect predictions', () => {
    const brier = computeBrierScore([0.5, 0.5], [true, false])
    expect(brier).toBeCloseTo(0.25, 5)
  })

  it('returns null Brier score on mismatched array lengths', () => {
    expect(computeBrierScore([0.5], [true, false])).toBeNull()
  })

  it('computes log loss without producing Infinity even at extreme predictions', () => {
    const logLoss = computeLogLoss([1, 0], [true, false])
    expect(Number.isFinite(logLoss)).toBe(true)
    expect(logLoss).toBeGreaterThanOrEqual(0)
  })
})

describe('evaluatePredictions bundling (spec §10 "never display a metric without its sample size")', () => {
  it('always includes sampleSize alongside every metric', () => {
    const result = evaluatePredictions([0.9, 0.1], [true, false])
    expect(result.sampleSize).toBe(2)
    expect(result.auc).toBe(1)
  })

  it('handles a zero-length (empty) dataset gracefully, returning nulls not throwing', () => {
    const result = evaluatePredictions([], [])
    expect(result.sampleSize).toBe(0)
    expect(result.auc).toBeNull()
    expect(result.brierScore).toBeNull()
    expect(result.confusionMatrix).toBeNull()
  })
})
