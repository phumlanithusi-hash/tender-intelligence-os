import { describe, expect, it } from 'vitest'
import { buildWalkForwardFolds, chronologicalSplit, verifyNoFutureLeakage, verifyWalkForwardIntegrity } from '../temporalValidation.js'
import type { DecisionTimeObservation } from '../types.js'

function makeObservation(daysFromEpoch: number, label: boolean): DecisionTimeObservation {
  const date = new Date(2026, 0, 1 + daysFromEpoch).toISOString()
  return {
    bidProjectId: `obs-${daysFromEpoch}`,
    decisionTimestamp: date,
    label,
    tenderCategory: null,
    province: null,
    estimatedValueBand: null,
    opportunityScoreAtDecision: 50,
    requirementCoverageAtDecision: 0.5,
    evidenceStrengthAtDecision: 0.5,
    commercialFitAtDecision: 0.5,
    strategicFitAtDecision: 0.5,
    qualificationStatusAtDecision: null,
    bidEffort: null,
    scoringConfigurationVersionId: null,
    bidPolicyVersionId: null,
  }
}

describe('chronologicalSplit (spec §9)', () => {
  it('splits strictly by time order, never randomly', () => {
    const observations = Array.from({ length: 10 }, (_, i) => makeObservation(i, i % 2 === 0))
    const split = chronologicalSplit(observations, 0.6, 0.2)
    expect(split.train).toHaveLength(6)
    expect(split.validation).toHaveLength(2)
    expect(split.test).toHaveLength(2)
    expect(split.train[0]!.bidProjectId).toBe('obs-0')
    expect(split.test[split.test.length - 1]!.bidProjectId).toBe('obs-9')
  })

  it('produces no future leakage on a correctly-ordered split', () => {
    const observations = Array.from({ length: 20 }, (_, i) => makeObservation(i, i % 3 === 0))
    const split = chronologicalSplit(observations)
    const check = verifyNoFutureLeakage(split)
    expect(check.valid).toBe(true)
  })

  it('detects future leakage if a split is deliberately reordered', () => {
    const observations = Array.from({ length: 10 }, (_, i) => makeObservation(i, i % 2 === 0))
    const split = chronologicalSplit(observations)
    // Deliberately corrupt: swap one late train observation into validation.
    const corrupted = { ...split, train: [...split.train, split.test[split.test.length - 1]!] }
    const check = verifyNoFutureLeakage(corrupted)
    expect(check.valid).toBe(false)
  })

  it('records the correct chronological period boundaries', () => {
    const observations = Array.from({ length: 10 }, (_, i) => makeObservation(i, true))
    const split = chronologicalSplit(observations, 0.6, 0.2)
    expect(new Date(split.trainPeriod.start!).getTime()).toBeLessThanOrEqual(new Date(split.trainPeriod.end!).getTime())
    expect(new Date(split.trainPeriod.end!).getTime()).toBeLessThanOrEqual(new Date(split.testPeriod.start!).getTime())
  })
})

describe('buildWalkForwardFolds / verifyWalkForwardIntegrity (spec §9/§37)', () => {
  it('builds folds where each fold trains only on strictly earlier data', () => {
    const observations = Array.from({ length: 30 }, (_, i) => makeObservation(i, i % 2 === 0))
    const folds = buildWalkForwardFolds(observations, 3)
    expect(folds.length).toBeGreaterThan(0)
    const integrity = verifyWalkForwardIntegrity(folds)
    expect(integrity.valid).toBe(true)
  })

  it('returns no folds for an empty dataset', () => {
    expect(buildWalkForwardFolds([], 3)).toEqual([])
  })

  it('detects a violated fold if constructed incorrectly', () => {
    const observations = Array.from({ length: 10 }, (_, i) => makeObservation(i, true))
    const folds = buildWalkForwardFolds(observations, 2)
    const corrupted = folds.map((f) => ({ ...f, train: [...f.train, ...f.test] }))
    // Now train includes test observations themselves, but they are
    // identical timestamps to the boundary — construct a real
    // violation by prepending a later observation into train.
    const violated = [{ ...corrupted[0]!, train: [...corrupted[0]!.train, makeObservation(29, true)] }]
    const integrity = verifyWalkForwardIntegrity(violated)
    expect(integrity.valid).toBe(false)
  })
})
