import { describe, it, expect } from 'vitest'
import { computeBidEffort } from '../bidEffort.js'

describe('computeBidEffort — Phase 11 §24/§25', () => {
  it('totally unknown inputs -> UNKNOWN, never a confident LOW', () => {
    const { level } = computeBidEffort({ mandatoryDocumentCount: 0, evaluationCriteriaCount: 0, presentationRequired: null, briefingCompulsory: null, mandatoryFormCount: 0 })
    expect(level).toBe('UNKNOWN')
  })

  it('minimal known structure -> LOW', () => {
    const { level } = computeBidEffort({ mandatoryDocumentCount: 2, evaluationCriteriaCount: 1, presentationRequired: false, briefingCompulsory: false, mandatoryFormCount: 1 })
    expect(level).toBe('LOW')
  })

  it('moderate structure -> MEDIUM', () => {
    const { level } = computeBidEffort({ mandatoryDocumentCount: 6, evaluationCriteriaCount: 4, presentationRequired: false, briefingCompulsory: false, mandatoryFormCount: 2 })
    expect(level).toBe('MEDIUM')
  })

  it('heavy structure -> HIGH', () => {
    const { level } = computeBidEffort({ mandatoryDocumentCount: 12, evaluationCriteriaCount: 9, presentationRequired: true, briefingCompulsory: true, mandatoryFormCount: 11 })
    expect(level).toBe('HIGH')
  })

  it('is deterministic for identical inputs', () => {
    const inputs = { mandatoryDocumentCount: 5, evaluationCriteriaCount: 4, presentationRequired: true, briefingCompulsory: false, mandatoryFormCount: 5 }
    expect(computeBidEffort(inputs)).toEqual(computeBidEffort(inputs))
  })

  it('never derives effort from opportunity score — the formula has no score input at all', () => {
    // Type-level guarantee: BidEffortInputs has no score field. This test
    // documents the intent (Phase 11 §25) alongside the type.
    const { level: a } = computeBidEffort({ mandatoryDocumentCount: 20, evaluationCriteriaCount: 20, presentationRequired: true, briefingCompulsory: true, mandatoryFormCount: 20 })
    expect(a).toBe('HIGH')
  })
})
