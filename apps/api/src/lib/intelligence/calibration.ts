import { CALIBRATION_BUCKET_COUNT, MAX_CALIBRATION_ERROR, MIN_CALIBRATION_BUCKET_SIZE } from '@tender-os/constants'
import { computeBrierScore } from './evaluation.js'
import type { CalibrationBucket, CalibrationResult } from './types.js'

/**
 * Phase 18 §11 — is predicted probability ≈ observed frequency? Buckets
 * predictions into deciles and compares each bucket's mean predicted
 * probability against its observed WON frequency (a reliability
 * diagram in table form). A bucket below MIN_CALIBRATION_BUCKET_SIZE is
 * flagged insufficientSample rather than silently included in the
 * headline calibration-error figure.
 */
export function buildCalibrationBuckets(predictions: number[], labels: boolean[], bucketCount = CALIBRATION_BUCKET_COUNT): CalibrationBucket[] {
  const buckets: CalibrationBucket[] = []
  for (let b = 0; b < bucketCount; b++) {
    const low = b / bucketCount
    const high = (b + 1) / bucketCount
    const indices = predictions
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => (b === bucketCount - 1 ? p >= low && p <= high : p >= low && p < high))
    const sampleSize = indices.length
    const meanPredicted = sampleSize > 0 ? indices.reduce((sum, { p }) => sum + p, 0) / sampleSize : null
    const observedFrequency = sampleSize > 0 ? indices.filter(({ i }) => labels[i]).length / sampleSize : null
    buckets.push({
      bucketIndex: b,
      predictedRangeLow: low,
      predictedRangeHigh: high,
      meanPredicted,
      observedFrequency,
      sampleSize,
      insufficientSample: sampleSize < MIN_CALIBRATION_BUCKET_SIZE,
    })
  }
  return buckets
}

/** Mean absolute calibration error across buckets that meet the
 * minimum sample size — never averaged in a bucket with too few
 * observations to mean anything (spec §11). Null if no bucket
 * qualifies. */
export function meanCalibrationError(buckets: CalibrationBucket[]): number | null {
  const qualifying = buckets.filter((b) => !b.insufficientSample && b.meanPredicted !== null && b.observedFrequency !== null)
  if (qualifying.length === 0) return null
  const total = qualifying.reduce((sum, b) => sum + Math.abs(b.meanPredicted! - b.observedFrequency!), 0)
  return total / qualifying.length
}

export function isWellCalibrated(error: number | null): boolean {
  return error !== null && error <= MAX_CALIBRATION_ERROR
}

export function buildCalibrationResult(predictions: number[], labels: boolean[]): CalibrationResult {
  const buckets = buildCalibrationBuckets(predictions, labels)
  return {
    method: 'NONE',
    buckets,
    meanCalibrationError: meanCalibrationError(buckets),
    brierScore: computeBrierScore(predictions, labels),
    sampleSize: predictions.length,
  }
}

/**
 * Platt scaling: fits a single-feature logistic regression of the
 * observed label on the model's raw predicted probability (via the
 * log-odds transform), producing a recalibration function. Simple,
 * interpretable, and appropriate at small sample sizes per spec §11
 * ("Platt scaling ... only where dataset supports it").
 */
export function fitPlattScaling(predictions: number[], labels: boolean[]): { a: number; b: number } {
  const eps = 1e-6
  const logits = predictions.map((p) => Math.log(Math.min(1 - eps, Math.max(eps, p)) / (1 - Math.min(1 - eps, Math.max(eps, p)))))
  const y = labels.map((l) => (l ? 1 : 0))
  let a = 1
  let b = 0
  const lr = 0.05
  const epochs = 300
  const n = logits.length || 1
  for (let epoch = 0; epoch < epochs; epoch++) {
    let gradA = 0
    let gradB = 0
    for (let i = 0; i < logits.length; i++) {
      const z = a * logits[i]! + b
      const pred = 1 / (1 + Math.exp(-z))
      const error = pred - y[i]!
      gradA += error * logits[i]!
      gradB += error
    }
    a -= lr * (gradA / n)
    b -= lr * (gradB / n)
  }
  return { a, b }
}

export function applyPlattScaling(rawProbability: number, plattParams: { a: number; b: number }): number {
  const eps = 1e-6
  const clamped = Math.min(1 - eps, Math.max(eps, rawProbability))
  const logit = Math.log(clamped / (1 - clamped))
  const z = plattParams.a * logit + plattParams.b
  return 1 / (1 + Math.exp(-z))
}
