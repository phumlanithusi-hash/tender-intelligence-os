import { describe, expect, it } from 'vitest'
import { evaluatePromotion, evaluateRetirement, isForwardTransitionAllowed } from '../governance.js'

const goodEvaluation = { sampleSize: 100, auc: 0.75, prAuc: 0.6, precision: 0.7, recall: 0.6, f1: 0.65, brierScore: 0.15, logLoss: 0.5, confusionMatrix: null }

describe('isForwardTransitionAllowed (spec §19)', () => {
  it('allows EXPERIMENTAL -> EVALUATED', () => {
    expect(isForwardTransitionAllowed('EXPERIMENTAL', 'EVALUATED')).toBe(true)
  })
  it('disallows skipping straight from EXPERIMENTAL to PRODUCTION', () => {
    expect(isForwardTransitionAllowed('EXPERIMENTAL', 'PRODUCTION')).toBe(false)
  })
  it('disallows any transition out of RETIRED', () => {
    expect(isForwardTransitionAllowed('RETIRED', 'PRODUCTION')).toBe(false)
  })
  it('disallows any transition out of FAILED', () => {
    expect(isForwardTransitionAllowed('FAILED', 'EVALUATED')).toBe(false)
  })
})

describe('evaluatePromotion — PRODUCTION_CANDIDATE -> PRODUCTION (spec §20/§30/§43)', () => {
  const base = {
    currentStatus: 'PRODUCTION_CANDIDATE' as const,
    targetStatus: 'PRODUCTION' as const,
    eligibilityState: 'PRODUCTION_ELIGIBLE' as const,
    latestEvaluation: goodEvaluation,
    bestBaselineAuc: 0.55,
    latestCalibrationError: 0.05,
    hasModelCard: true,
    approverRole: 'ADMIN',
  }

  it('allows promotion when every gate passes', () => {
    const result = evaluatePromotion(base)
    expect(result.allowed).toBe(true)
  })

  it('rejects when eligibility state is not PRODUCTION_ELIGIBLE', () => {
    const result = evaluatePromotion({ ...base, eligibilityState: 'INSUFFICIENT_DATA' })
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/PRODUCTION_ELIGIBLE/)
  })

  it('rejects when the approver role is not authorised', () => {
    const result = evaluatePromotion({ ...base, approverRole: 'BID_MANAGER' })
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/authorised approver/)
  })

  it('rejects when no model card exists', () => {
    const result = evaluatePromotion({ ...base, hasModelCard: false })
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/model card/)
  })

  it('rejects when model AUC does not beat the best baseline by the required margin', () => {
    const result = evaluatePromotion({ ...base, bestBaselineAuc: 0.74 })
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/does not beat the best baseline/)
  })

  it('rejects when calibration error exceeds the ceiling', () => {
    const result = evaluatePromotion({ ...base, latestCalibrationError: 0.5 })
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/Calibration error/)
  })

  it('rejects an out-of-order transition (e.g. EXPERIMENTAL -> PRODUCTION)', () => {
    const result = evaluatePromotion({ ...base, currentStatus: 'EXPERIMENTAL' })
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/not an allowed governance transition/)
  })

  it('rejects when no baseline AUC is available at all', () => {
    const result = evaluatePromotion({ ...base, bestBaselineAuc: null })
    expect(result.allowed).toBe(false)
  })
})

describe('evaluateRetirement (spec §31)', () => {
  it('allows retiring a PRODUCTION model by an authorised approver', () => {
    const result = evaluateRetirement('PRODUCTION', 'ADMIN')
    expect(result.allowed).toBe(true)
  })
  it('rejects retiring a non-PRODUCTION model', () => {
    const result = evaluateRetirement('EVALUATED', 'ADMIN')
    expect(result.allowed).toBe(false)
  })
  it('rejects retirement by an unauthorised role', () => {
    const result = evaluateRetirement('PRODUCTION', 'BID_MANAGER')
    expect(result.allowed).toBe(false)
  })
})
