import { describe, expect, it } from 'vitest'
import { calculateBidReadiness, type BidReadinessInput } from '../readiness.js'

function baseInput(): BidReadinessInput {
  return {
    nowIso: '2026-09-11T00:00:00Z',
    tenderClosingDate: '2026-12-01',
    briefingRequired: false,
    briefingStatusResolved: true,
    submissionRequirementsResolved: true,
    criticalHumanReviewOutstanding: false,
    mandatoryRequirements: [{ id: 'req-1', qualificationStatus: 'PASS' }],
    requirementPlans: [{ tenderRequirementId: 'req-1', evidenceRequired: true, evidenceStatus: 'SUPPORTED', responseStatus: 'READY' }],
    evaluationCriteria: [{ id: 'crit-1', weight: 30 }],
    evaluationStrategies: [{ evaluationCriterionId: 'crit-1', strategy: 'Respond with methodology.' }],
    evidenceNeeds: [],
    tasks: [{ id: 'task-1', status: 'DONE' }],
  }
}

describe('calculateBidReadiness (Phase 12 §22/§23) — pure, deterministic', () => {
  it('a fully complete project is READY', () => {
    const result = calculateBidReadiness(baseInput())
    expect(result.status).toBe('READY')
    expect(result.blockers).toHaveLength(0)
  })

  it('one outstanding mandatory requirement BLOCKS the project even at otherwise-high completeness (blockers override completeness)', () => {
    const input = baseInput()
    input.mandatoryRequirements = [
      { id: 'req-1', qualificationStatus: 'PASS' },
      { id: 'req-2', qualificationStatus: 'UNKNOWN' },
    ]
    const result = calculateBidReadiness(input)
    expect(result.status).toBe('BLOCKED')
    expect(result.completeness.requirements).toBeGreaterThan(0.4) // high completeness...
    expect(result.blockers.some((b) => b.code === 'MANDATORY_REQUIREMENT_UNRESOLVED')).toBe(true) // ...still BLOCKED
  })

  it('a CRITICAL, unresolved evidence gap BLOCKS the project', () => {
    const input = baseInput()
    input.evidenceNeeds = [{ id: 'need-1', status: 'OPEN', severity: 'CRITICAL' }]
    const result = calculateBidReadiness(input)
    expect(result.status).toBe('BLOCKED')
    expect(result.blockers.some((b) => b.code === 'CRITICAL_EVIDENCE_GAP')).toBe(true)
  })

  it('a non-critical evidence gap produces REVIEW, not BLOCKED', () => {
    const input = baseInput()
    input.evidenceNeeds = [{ id: 'need-1', status: 'OPEN', severity: 'MEDIUM' }]
    const result = calculateBidReadiness(input)
    expect(result.status).toBe('REVIEW')
  })

  it('a tender past its closing date is BLOCKED', () => {
    const input = baseInput()
    input.tenderClosingDate = '2026-01-01'
    const result = calculateBidReadiness(input)
    expect(result.status).toBe('BLOCKED')
    expect(result.blockers.some((b) => b.code === 'TENDER_CLOSED')).toBe(true)
  })

  it('an unresolved compulsory briefing status is BLOCKED', () => {
    const input = baseInput()
    input.briefingRequired = true
    input.briefingStatusResolved = false
    const result = calculateBidReadiness(input)
    expect(result.status).toBe('BLOCKED')
    expect(result.blockers.some((b) => b.code === 'BRIEFING_STATUS_UNRESOLVED')).toBe(true)
  })

  it('an evaluation criterion with no response strategy is BLOCKED', () => {
    const input = baseInput()
    input.evaluationStrategies = []
    const result = calculateBidReadiness(input)
    expect(result.status).toBe('BLOCKED')
    expect(result.blockers.some((b) => b.code === 'EVALUATION_CRITERION_NO_STRATEGY')).toBe(true)
  })

  it('never reports readiness as a bare percentage — completeness is always structured, status always present', () => {
    const result = calculateBidReadiness(baseInput())
    expect(typeof result.status).toBe('string')
    expect(typeof result.completeness).toBe('object')
    expect(result.completeness.requirements).not.toBeUndefined()
  })
})
