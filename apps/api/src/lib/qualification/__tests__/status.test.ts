import { describe, it, expect } from 'vitest'
import { computeOverallStatus, summarizeResults } from '../status.js'
import type { RuleResult } from '../types.js'

function result(over: Partial<RuleResult>): RuleResult {
  return {
    status: 'PASS',
    mandatory: true,
    explanation: 'x',
    agencyEvidence: [],
    tenderEvidence: [],
    evaluatedBy: 'DETERMINISTIC_RULE',
    confidence: null,
    requiresHumanReview: false,
    actions: [],
    ...over,
  }
}

describe('computeOverallStatus — Phase 8 §25/§37 precedence tests', () => {
  it('1. all mandatory PASS -> ELIGIBLE', () => {
    const results = [result({ status: 'PASS', mandatory: true }), result({ status: 'PASS', mandatory: false })]
    expect(computeOverallStatus(results)).toBe('ELIGIBLE')
  })

  it('2. a mandatory FAIL -> NOT_ELIGIBLE', () => {
    const results = [result({ status: 'FAIL', mandatory: true }), result({ status: 'PASS', mandatory: true })]
    expect(computeOverallStatus(results)).toBe('NOT_ELIGIBLE')
  })

  it('3. a mandatory UNKNOWN (no mandatory FAIL) -> REQUIRES_REVIEW', () => {
    const results = [result({ status: 'UNKNOWN', mandatory: true }), result({ status: 'PASS', mandatory: true })]
    expect(computeOverallStatus(results)).toBe('REQUIRES_REVIEW')
  })

  it('4. a mandatory REQUIRES_ACTION (no mandatory FAIL/UNKNOWN) -> ACTION_REQUIRED', () => {
    const results = [result({ status: 'REQUIRES_ACTION', mandatory: true }), result({ status: 'PASS', mandatory: true })]
    expect(computeOverallStatus(results)).toBe('ACTION_REQUIRED')
  })

  it('5. an optional (non-mandatory) FAIL does not cause NOT_ELIGIBLE', () => {
    const results = [result({ status: 'FAIL', mandatory: false }), result({ status: 'PASS', mandatory: true })]
    expect(computeOverallStatus(results)).not.toBe('NOT_ELIGIBLE')
    expect(computeOverallStatus(results)).toBe('ELIGIBLE')
  })

  it('6. a preferential requirement failure does not cause NOT_ELIGIBLE', () => {
    // PREFERENTIAL requirements are represented with mandatory=false —
    // mandatoryStatus PREFERENTIAL never sets the `mandatory` flag.
    const results = [result({ status: 'FAIL', mandatory: false }), result({ status: 'PASS', mandatory: true })]
    expect(computeOverallStatus(results)).toBe('ELIGIBLE')
  })

  it('a mandatory FAIL always wins over an unrelated requiresHumanReview flag elsewhere', () => {
    const results = [result({ status: 'FAIL', mandatory: true }), result({ status: 'PASS', mandatory: false, requiresHumanReview: true })]
    expect(computeOverallStatus(results)).toBe('NOT_ELIGIBLE')
  })

  it('requiresHumanReview on a non-mandatory requirement still forces REQUIRES_REVIEW (never silently resolved)', () => {
    const results = [result({ status: 'PASS', mandatory: true }), result({ status: 'REQUIRES_ACTION', mandatory: false, requiresHumanReview: true })]
    expect(computeOverallStatus(results)).toBe('REQUIRES_REVIEW')
  })

  it('a non-mandatory UNKNOWN with nothing else outstanding -> UNKNOWN, not ELIGIBLE', () => {
    const results = [result({ status: 'UNKNOWN', mandatory: false })]
    expect(computeOverallStatus(results)).toBe('UNKNOWN')
  })

  it('empty result set -> ELIGIBLE (no identified blocker), never a false negative', () => {
    expect(computeOverallStatus([])).toBe('ELIGIBLE')
  })
})

describe('summarizeResults', () => {
  it('counts mandatory blockers, actions required, and review flags independently', () => {
    const results = [
      result({ status: 'FAIL', mandatory: true }),
      result({ status: 'REQUIRES_ACTION', mandatory: false }),
      result({ status: 'PASS', mandatory: true, requiresHumanReview: true }),
    ]
    const summary = summarizeResults(results)
    expect(summary.mandatoryBlockerCount).toBe(1)
    expect(summary.actionRequiredCount).toBe(1)
    expect(summary.requiresReviewCount).toBe(1)
    expect(summary.requirementCount).toBe(3)
  })
})
