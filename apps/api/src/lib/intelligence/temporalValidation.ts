import type { DecisionTimeObservation, TemporalSplit, WalkForwardFold } from './types.js'

/**
 * Phase 18 §9 — temporal (never purely random) train/validation/test
 * splitting. Procurement data is temporal: a model trained partly on
 * observations chronologically AFTER the ones it is validated against
 * would be validated on information it could not have had at the time
 * — this module makes that structurally impossible.
 */

function sortByDecisionTime(observations: DecisionTimeObservation[]): DecisionTimeObservation[] {
  return [...observations].sort((a, b) => new Date(a.decisionTimestamp).getTime() - new Date(b.decisionTimestamp).getTime())
}

function periodOf(observations: DecisionTimeObservation[]): { start: string | null; end: string | null } {
  if (observations.length === 0) return { start: null, end: null }
  return { start: observations[0]!.decisionTimestamp, end: observations[observations.length - 1]!.decisionTimestamp }
}

/**
 * Chronological train (earliest) / validation (middle) / test (most
 * recent) split by proportion — never a random shuffle. Every
 * observation in `validation` and `test` has a decisionTimestamp
 * strictly >= every observation in the periods before it (spec §9).
 */
export function chronologicalSplit(
  observations: DecisionTimeObservation[],
  trainFraction = 0.6,
  validationFraction = 0.2,
): TemporalSplit {
  const sorted = sortByDecisionTime(observations)
  const n = sorted.length
  const trainEnd = Math.floor(n * trainFraction)
  const validationEnd = Math.floor(n * (trainFraction + validationFraction))
  const train = sorted.slice(0, trainEnd)
  const validation = sorted.slice(trainEnd, validationEnd)
  const test = sorted.slice(validationEnd)
  return {
    train,
    validation,
    test,
    trainPeriod: periodOf(train),
    validationPeriod: periodOf(validation),
    testPeriod: periodOf(test),
  }
}

/**
 * Verifies a split has no chronological leakage: every train
 * timestamp must be <= every validation timestamp, and every
 * validation timestamp <= every test timestamp. Used both by tests
 * and defensively before any evaluation run.
 */
export function verifyNoFutureLeakage(split: TemporalSplit): { valid: boolean; reason: string | null } {
  const maxTrain = split.train.length > 0 ? Math.max(...split.train.map((o) => new Date(o.decisionTimestamp).getTime())) : -Infinity
  const minValidation = split.validation.length > 0 ? Math.min(...split.validation.map((o) => new Date(o.decisionTimestamp).getTime())) : Infinity
  const maxValidation = split.validation.length > 0 ? Math.max(...split.validation.map((o) => new Date(o.decisionTimestamp).getTime())) : -Infinity
  const minTest = split.test.length > 0 ? Math.min(...split.test.map((o) => new Date(o.decisionTimestamp).getTime())) : Infinity

  if (maxTrain > minValidation) return { valid: false, reason: 'A training observation occurs chronologically after a validation observation.' }
  if (maxValidation > minTest) return { valid: false, reason: 'A validation observation occurs chronologically after a test observation.' }
  return { valid: true, reason: null }
}

/**
 * Walk-forward (expanding-window) validation folds (spec §9): fold k's
 * training set is every observation strictly before fold k's test
 * window, and the test window itself is a forward-moving chronological
 * slice — never overlapping, never reordered.
 */
export function buildWalkForwardFolds(observations: DecisionTimeObservation[], foldCount: number): WalkForwardFold[] {
  const sorted = sortByDecisionTime(observations)
  const n = sorted.length
  if (foldCount < 1 || n === 0) return []
  const testSize = Math.max(1, Math.floor(n / (foldCount + 1)))
  const folds: WalkForwardFold[] = []
  for (let fold = 0; fold < foldCount; fold++) {
    const trainEnd = testSize * (fold + 1)
    const testEnd = Math.min(n, trainEnd + testSize)
    if (trainEnd >= n) break
    folds.push({
      foldIndex: fold,
      train: sorted.slice(0, trainEnd),
      test: sorted.slice(trainEnd, testEnd),
    })
  }
  return folds
}

/** Asserts every fold's test observations chronologically follow all
 * of that fold's training observations — the walk-forward-integrity
 * guarantee spec §37 requires be tested explicitly. */
export function verifyWalkForwardIntegrity(folds: WalkForwardFold[]): { valid: boolean; reason: string | null } {
  for (const fold of folds) {
    const maxTrain = fold.train.length > 0 ? Math.max(...fold.train.map((o) => new Date(o.decisionTimestamp).getTime())) : -Infinity
    const minTest = fold.test.length > 0 ? Math.min(...fold.test.map((o) => new Date(o.decisionTimestamp).getTime())) : Infinity
    if (maxTrain > minTest) return { valid: false, reason: `Fold ${fold.foldIndex}: a training observation occurs after a test observation.` }
  }
  return { valid: true, reason: null }
}
