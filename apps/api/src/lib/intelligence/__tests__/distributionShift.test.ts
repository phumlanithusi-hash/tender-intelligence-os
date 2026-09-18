import { describe, expect, it } from 'vitest'
import { detectDistributionShift } from '../distributionShift.js'

const trainingSets = {
  trainingCategories: new Set(['IT_SERVICES', 'CONSTRUCTION']),
  trainingProvinces: new Set(['GAUTENG']),
  trainingValueBands: new Set(['R1M_5M']),
  trainingSampleSize: 100,
}

describe('detectDistributionShift (spec §18)', () => {
  it('detects no shift for a candidate matching the training population', () => {
    const result = detectDistributionShift({ ...trainingSets, candidateCategory: 'IT_SERVICES', candidateProvince: 'GAUTENG', candidateValueBand: 'R1M_5M' })
    expect(result.shiftDetected).toBe(false)
  })

  it('detects a shift for an unseen category', () => {
    const result = detectDistributionShift({ ...trainingSets, candidateCategory: 'HEALTHCARE', candidateProvince: 'GAUTENG', candidateValueBand: 'R1M_5M' })
    expect(result.shiftDetected).toBe(true)
    expect(result.reasons.join(' ')).toMatch(/HEALTHCARE/)
  })

  it('detects a shift for an unseen province', () => {
    const result = detectDistributionShift({ ...trainingSets, candidateCategory: 'IT_SERVICES', candidateProvince: 'LIMPOPO', candidateValueBand: 'R1M_5M' })
    expect(result.shiftDetected).toBe(true)
  })

  it('detects a shift for a training sample below the minimum training size regardless of category match', () => {
    const result = detectDistributionShift({ ...trainingSets, trainingSampleSize: 10, candidateCategory: 'IT_SERVICES', candidateProvince: 'GAUTENG', candidateValueBand: 'R1M_5M' })
    expect(result.shiftDetected).toBe(true)
  })

  it('does not flag a shift when a candidate field is simply unknown (null)', () => {
    const result = detectDistributionShift({ ...trainingSets, candidateCategory: null, candidateProvince: null, candidateValueBand: null })
    expect(result.shiftDetected).toBe(false)
  })
})
