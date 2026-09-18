import type { EvaluationMetrics } from './types.js'

/**
 * Phase 18 §10 — pure statistical evaluation functions. Zero I/O, zero
 * randomness: every metric here is a deterministic function of
 * (predictions, labels) so it can be unit-tested against hand-computed
 * expected values.
 */

/**
 * ROC-AUC via the Mann-Whitney U statistic (rank-sum method) — exact,
 * no numerical-integration approximation, and correctly handles tied
 * scores (averaged ranks). Returns null when a sample is degenerate
 * (fewer than one positive or one negative — AUC is undefined).
 */
export function computeAUC(predictions: number[], labels: boolean[]): number | null {
  if (predictions.length !== labels.length || predictions.length === 0) return null
  const positives = predictions.filter((_, i) => labels[i])
  const negatives = predictions.filter((_, i) => !labels[i])
  if (positives.length === 0 || negatives.length === 0) return null

  // Rank all predictions (ascending), averaging ranks for ties.
  const indexed = predictions.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p)
  const ranks = new Array<number>(predictions.length)
  let idx = 0
  while (idx < indexed.length) {
    let j = idx
    while (j + 1 < indexed.length && indexed[j + 1]!.p === indexed[idx]!.p) j++
    const avgRank = (idx + j) / 2 + 1 // 1-based average rank across the tie block
    for (let k = idx; k <= j; k++) ranks[indexed[k]!.i] = avgRank
    idx = j + 1
  }
  const sumPositiveRanks = labels.reduce((sum, isPositive, i) => (isPositive ? sum + ranks[i]! : sum), 0)
  const n1 = positives.length
  const n0 = negatives.length
  const auc = (sumPositiveRanks - (n1 * (n1 + 1)) / 2) / (n1 * n0)
  return auc
}

/**
 * Precision-Recall AUC via the trapezoidal rule over the empirical
 * precision/recall curve swept across every distinct prediction value
 * as a threshold. Null on a degenerate sample (no positives).
 */
export function computePRAUC(predictions: number[], labels: boolean[]): number | null {
  if (predictions.length !== labels.length || predictions.length === 0) return null
  const totalPositives = labels.filter(Boolean).length
  if (totalPositives === 0) return null

  const thresholds = Array.from(new Set(predictions)).sort((a, b) => b - a)
  const points: Array<{ recall: number; precision: number }> = []
  for (const t of thresholds) {
    let tp = 0
    let fp = 0
    for (let i = 0; i < predictions.length; i++) {
      if (predictions[i]! >= t) {
        if (labels[i]) tp++
        else fp++
      }
    }
    const precision = tp + fp > 0 ? tp / (tp + fp) : 1
    const recall = tp / totalPositives
    points.push({ recall, precision })
  }
  // Anchor the curve at (recall=0, precision=1) — the conventional
  // starting point before any prediction is accepted as positive.
  points.push({ recall: 0, precision: 1 })
  points.sort((a, b) => a.recall - b.recall)
  let area = 0
  for (let i = 1; i < points.length; i++) {
    const dx = points[i]!.recall - points[i - 1]!.recall
    const avgY = (points[i]!.precision + points[i - 1]!.precision) / 2
    area += dx * avgY
  }
  return area
}

export function computeConfusionMatrix(predictions: number[], labels: boolean[], threshold = 0.5): EvaluationMetrics['confusionMatrix'] {
  if (predictions.length !== labels.length || predictions.length === 0) return null
  let truePositive = 0
  let falsePositive = 0
  let trueNegative = 0
  let falseNegative = 0
  for (let i = 0; i < predictions.length; i++) {
    const predicted = predictions[i]! >= threshold
    if (predicted && labels[i]) truePositive++
    else if (predicted && !labels[i]) falsePositive++
    else if (!predicted && !labels[i]) trueNegative++
    else falseNegative++
  }
  return { truePositive, falsePositive, trueNegative, falseNegative }
}

export function computePrecisionRecallF1(predictions: number[], labels: boolean[], threshold = 0.5): { precision: number | null; recall: number | null; f1: number | null } {
  const cm = computeConfusionMatrix(predictions, labels, threshold)
  if (!cm) return { precision: null, recall: null, f1: null }
  const precision = cm.truePositive + cm.falsePositive > 0 ? cm.truePositive / (cm.truePositive + cm.falsePositive) : null
  const recall = cm.truePositive + cm.falseNegative > 0 ? cm.truePositive / (cm.truePositive + cm.falseNegative) : null
  const f1 = precision !== null && recall !== null && precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : null
  return { precision, recall, f1 }
}

/** Mean squared error between predicted probability and the binary
 * outcome — the standard proper scoring rule for probabilistic
 * calibration quality (spec §10/§11). */
export function computeBrierScore(predictions: number[], labels: boolean[]): number | null {
  if (predictions.length !== labels.length || predictions.length === 0) return null
  const sum = predictions.reduce((acc, p, i) => acc + (p - (labels[i] ? 1 : 0)) ** 2, 0)
  return sum / predictions.length
}

/** Clamped to avoid -Infinity at p=0/p=1 (a real model should never
 * emit exactly 0 or 1, but the clamp keeps the metric finite even if
 * one does). */
export function computeLogLoss(predictions: number[], labels: boolean[]): number | null {
  if (predictions.length !== labels.length || predictions.length === 0) return null
  const eps = 1e-15
  const sum = predictions.reduce((acc, rawP, i) => {
    const p = Math.min(1 - eps, Math.max(eps, rawP))
    return acc + (labels[i] ? Math.log(p) : Math.log(1 - p))
  }, 0)
  return -sum / predictions.length
}

/**
 * Bundles every metric from spec §10 with its sample size — spec §10
 * "never display a metric without its sample size" is enforced by
 * this being the ONLY way the route layer computes evaluation output.
 */
export function evaluatePredictions(predictions: number[], labels: boolean[], threshold = 0.5): EvaluationMetrics {
  const { precision, recall, f1 } = computePrecisionRecallF1(predictions, labels, threshold)
  return {
    sampleSize: predictions.length,
    auc: computeAUC(predictions, labels),
    prAuc: computePRAUC(predictions, labels),
    precision,
    recall,
    f1,
    brierScore: computeBrierScore(predictions, labels),
    logLoss: computeLogLoss(predictions, labels),
    confusionMatrix: computeConfusionMatrix(predictions, labels, threshold),
  }
}
