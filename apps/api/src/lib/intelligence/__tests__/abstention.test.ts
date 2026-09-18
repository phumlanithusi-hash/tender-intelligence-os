import { describe, expect, it } from 'vitest'
import { evaluateAbstention } from '../abstention.js'

const okBase = {
  eligibilityState: 'PRODUCTION_ELIGIBLE' as const,
  modelStatus: 'PRODUCTION' as const,
  segmentSampleSize: 20,
  hasCriticalFeatures: true,
  distributionShift: { shiftDetected: false, reasons: [] },
  calibrationError: 0.05,
}

describe('evaluateAbstention (spec §13)', () => {
  it('does not abstain when every check passes', () => {
    const result = evaluateAbstention(okBase)
    expect(result.shouldAbstain).toBe(false)
    expect(result.reason).toBeNull()
  })

  it('abstains with LEAKAGE_DETECTED as the highest-priority reason', () => {
    const result = evaluateAbstention({ ...okBase, eligibilityState: 'LEAKAGE_DETECTED' })
    expect(result.shouldAbstain).toBe(true)
    expect(result.reason).toBe('LEAKAGE_DETECTED')
  })

  it('abstains with INSUFFICIENT_VERIFIED_OUTCOMES when dataset is INSUFFICIENT_DATA', () => {
    const result = evaluateAbstention({ ...okBase, eligibilityState: 'INSUFFICIENT_DATA' })
    expect(result.shouldAbstain).toBe(true)
    expect(result.reason).toBe('INSUFFICIENT_VERIFIED_OUTCOMES')
  })

  it('abstains with MODEL_NOT_PRODUCTION_ELIGIBLE when no PRODUCTION model exists', () => {
    const result = evaluateAbstention({ ...okBase, modelStatus: null })
    expect(result.shouldAbstain).toBe(true)
    expect(result.reason).toBe('MODEL_NOT_PRODUCTION_ELIGIBLE')
  })

  it('abstains with INSUFFICIENT_SEGMENT_SAMPLE for a thin segment', () => {
    const result = evaluateAbstention({ ...okBase, segmentSampleSize: 2 })
    expect(result.shouldAbstain).toBe(true)
    expect(result.reason).toBe('INSUFFICIENT_SEGMENT_SAMPLE')
  })

  it('abstains with MISSING_CRITICAL_FEATURES when required features are absent', () => {
    const result = evaluateAbstention({ ...okBase, hasCriticalFeatures: false })
    expect(result.shouldAbstain).toBe(true)
    expect(result.reason).toBe('MISSING_CRITICAL_FEATURES')
  })

  it('abstains with DISTRIBUTION_SHIFT when a shift is detected', () => {
    const result = evaluateAbstention({ ...okBase, distributionShift: { shiftDetected: true, reasons: ['unseen category'] } })
    expect(result.shouldAbstain).toBe(true)
    expect(result.reason).toBe('DISTRIBUTION_SHIFT')
  })

  it('abstains with CALIBRATION_INSUFFICIENT when calibration error is too high', () => {
    const result = evaluateAbstention({ ...okBase, calibrationError: 0.9 })
    expect(result.shouldAbstain).toBe(true)
    expect(result.reason).toBe('CALIBRATION_INSUFFICIENT')
  })

  it('never forces a numerical prediction — abstention is always explicit, never a fallback default value', () => {
    const result = evaluateAbstention({ ...okBase, eligibilityState: 'HIGH_CLASS_IMBALANCE' })
    expect(result.shouldAbstain).toBe(true)
    expect(typeof result.detail).toBe('string')
    expect(result.detail.length).toBeGreaterThan(0)
  })
})
