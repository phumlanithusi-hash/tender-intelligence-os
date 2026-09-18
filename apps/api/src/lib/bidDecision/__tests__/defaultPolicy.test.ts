import { describe, it, expect } from 'vitest'
import { assertValidBidPolicy, DEFAULT_BID_POLICY } from '../defaultPolicy.js'

describe('assertValidBidPolicy — Phase 11 §59 configuration validation', () => {
  it('accepts the default policy', () => {
    expect(() => assertValidBidPolicy(DEFAULT_BID_POLICY)).not.toThrow()
  })

  it('rejects a score threshold above 100', () => {
    expect(() => assertValidBidPolicy({ ...DEFAULT_BID_POLICY, minimumOpportunityScore: { active: true, severity: 'NO_BID', value: 150 } })).toThrow()
  })

  it('rejects a negative score threshold', () => {
    expect(() => assertValidBidPolicy({ ...DEFAULT_BID_POLICY, minimumRequirementCoverage: { active: true, severity: 'REVIEW', value: -5 } })).toThrow()
  })

  it('rejects negative minimum preparation days', () => {
    expect(() => assertValidBidPolicy({ ...DEFAULT_BID_POLICY, minimumPreparationDays: { active: true, severity: 'REVIEW', value: -1 } })).toThrow()
  })

  it('rejects a data completeness threshold outside 0-1', () => {
    expect(() => assertValidBidPolicy({ ...DEFAULT_BID_POLICY, minimumDataCompleteness: { active: true, severity: 'REVIEW', value: 1.5 } })).toThrow()
  })

  it('rejects a precedence list missing a required step', () => {
    expect(() => assertValidBidPolicy({ ...DEFAULT_BID_POLICY, precedence: DEFAULT_BID_POLICY.precedence.slice(0, -1) })).toThrow()
  })

  it('rejects a duplicate entry in the precedence list', () => {
    expect(() => assertValidBidPolicy({ ...DEFAULT_BID_POLICY, precedence: [...DEFAULT_BID_POLICY.precedence.slice(0, -1), 'CLOSED_TENDER'] })).toThrow()
  })

  it('rejects an invalid precedence step name', () => {
    const bad = [...DEFAULT_BID_POLICY.precedence.slice(0, -1), 'NOT_A_REAL_STEP'] as unknown as typeof DEFAULT_BID_POLICY.precedence
    expect(() => assertValidBidPolicy({ ...DEFAULT_BID_POLICY, precedence: bad })).toThrow()
  })

  it('rejects an invalid score band', () => {
    expect(() => assertValidBidPolicy({ ...DEFAULT_BID_POLICY, scoreBands: [{ min: 60, max: 40, label: 'broken' }] })).toThrow()
  })
})
