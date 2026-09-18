import { describe, expect, it } from 'vitest'
import { applyPlattScaling, buildCalibrationBuckets, buildCalibrationResult, fitPlattScaling, isWellCalibrated, meanCalibrationError } from '../calibration.js'

describe('buildCalibrationBuckets (spec §11)', () => {
  it('places predictions into the correct decile buckets', () => {
    const predictions = [0.05, 0.15, 0.95]
    const labels = [false, true, true]
    const buckets = buildCalibrationBuckets(predictions, labels, 10)
    expect(buckets).toHaveLength(10)
    expect(buckets[0]!.sampleSize).toBe(1)
    expect(buckets[1]!.sampleSize).toBe(1)
    expect(buckets[9]!.sampleSize).toBe(1)
  })

  it('flags a bucket insufficientSample when below the minimum bucket size', () => {
    const buckets = buildCalibrationBuckets([0.05], [true], 10)
    expect(buckets[0]!.insufficientSample).toBe(true)
  })

  it('does not flag a bucket with enough observations', () => {
    const predictions = Array.from({ length: 6 }, () => 0.05)
    const labels = Array.from({ length: 6 }, (_, i) => i % 2 === 0)
    const buckets = buildCalibrationBuckets(predictions, labels, 10)
    expect(buckets[0]!.insufficientSample).toBe(false)
  })
})

describe('meanCalibrationError', () => {
  it('is near-zero for perfectly calibrated buckets', () => {
    // 10 observations per bucket at p=0.5, exactly half win.
    const predictions = Array.from({ length: 10 }, () => 0.5)
    const labels = [true, true, true, true, true, false, false, false, false, false]
    const buckets = buildCalibrationBuckets(predictions, labels, 10)
    const error = meanCalibrationError(buckets)
    expect(error).not.toBeNull()
    expect(error!).toBeCloseTo(0, 5)
  })

  it('returns null when no bucket has enough samples', () => {
    const buckets = buildCalibrationBuckets([0.1, 0.9], [true, false], 10)
    expect(meanCalibrationError(buckets)).toBeNull()
  })

  it('isWellCalibrated is false when error is null', () => {
    expect(isWellCalibrated(null)).toBe(false)
  })

  it('isWellCalibrated is true below the configured ceiling', () => {
    expect(isWellCalibrated(0.05)).toBe(true)
  })
})

describe('buildCalibrationResult', () => {
  it('bundles buckets, error, brier score and sample size together', () => {
    const result = buildCalibrationResult([0.9, 0.1], [true, false])
    expect(result.sampleSize).toBe(2)
    expect(result.brierScore).toBeCloseTo(0.01, 6)
  })
})

describe('Platt scaling (spec §11)', () => {
  it('fits parameters and recalibrated probabilities remain within [0,1]', () => {
    const predictions = [0.1, 0.3, 0.6, 0.9]
    const labels = [false, false, true, true]
    const params = fitPlattScaling(predictions, labels)
    for (const p of predictions) {
      const recalibrated = applyPlattScaling(p, params)
      expect(recalibrated).toBeGreaterThanOrEqual(0)
      expect(recalibrated).toBeLessThanOrEqual(1)
    }
  })
})
