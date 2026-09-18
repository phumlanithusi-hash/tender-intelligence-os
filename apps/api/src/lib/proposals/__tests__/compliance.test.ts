import { describe, expect, it } from 'vitest'
import { evaluateProposalCompliance } from '../compliance.js'
import type { ComplianceInput } from '../types.js'

function baseInput(overrides: Partial<ComplianceInput> = {}): ComplianceInput {
  return {
    requiredSectionTypesPresent: ['COVER', 'EXECUTIVE_SUMMARY', 'COMPLIANCE'],
    expectedSectionTypes: [],
    sections: [
      { id: 's-cover', sectionType: 'COVER', isMandatory: true, status: 'APPROVED_INTERNAL', hasContent: true, hasUnresolvedPlaceholder: false },
      { id: 's-exec', sectionType: 'EXECUTIVE_SUMMARY', isMandatory: true, status: 'APPROVED_INTERNAL', hasContent: true, hasUnresolvedPlaceholder: false },
      { id: 's-compliance', sectionType: 'COMPLIANCE', isMandatory: true, status: 'APPROVED_INTERNAL', hasContent: true, hasUnresolvedPlaceholder: false },
    ],
    requirements: [],
    evaluations: [],
    claims: [],
    pricingRequired: false,
    pricingProvided: false,
    isStale: false,
    staleReason: null,
    ...overrides,
  }
}

describe('evaluateProposalCompliance (Phase 14 §21/§22)', () => {
  it('returns READY_FOR_INTERNAL_REVIEW when every required section is present with content and nothing else is wrong', () => {
    const outcome = evaluateProposalCompliance(baseInput())
    expect(outcome.result).toBe('READY_FOR_INTERNAL_REVIEW')
    expect(outcome.issues).toHaveLength(0)
  })

  it('a missing mandatory requirement is a BLOCKER, never READY', () => {
    const outcome = evaluateProposalCompliance(baseInput({ requirements: [{ id: 'r1', mandatory: true, coveredBySectionId: null, coverageStatus: 'NOT_COVERED' }] }))
    expect(outcome.result).toBe('BLOCKED')
    expect(outcome.issues.some((i) => i.code === 'MANDATORY_REQUIREMENT_NOT_ADDRESSED')).toBe(true)
  })

  it('an unresolved placeholder in a mandatory section is a BLOCKER', () => {
    const outcome = evaluateProposalCompliance(
      baseInput({
        sections: [{ id: 's-exec', sectionType: 'EXECUTIVE_SUMMARY', isMandatory: true, status: 'DRAFT', hasContent: true, hasUnresolvedPlaceholder: true }, ...baseInput().sections.filter((s) => s.sectionType !== 'EXECUTIVE_SUMMARY')],
      }),
    )
    expect(outcome.result).toBe('BLOCKED')
    expect(outcome.issues.some((i) => i.code === 'UNRESOLVED_PLACEHOLDER' && i.severity === 'BLOCKER')).toBe(true)
  })

  it('an unresolved placeholder in a non-mandatory section is a WARNING, not a blocker', () => {
    const outcome = evaluateProposalCompliance(
      baseInput({
        sections: [...baseInput().sections, { id: 's-team', sectionType: 'TEAM', isMandatory: false, status: 'DRAFT', hasContent: true, hasUnresolvedPlaceholder: true }],
      }),
    )
    expect(outcome.result).toBe('REQUIRES_REVIEW')
    expect(outcome.issues.some((i) => i.code === 'UNRESOLVED_PLACEHOLDER' && i.severity === 'WARNING')).toBe(true)
  })

  it('an UNSUPPORTED claim is always a BLOCKER (never silently treated as fine)', () => {
    const outcome = evaluateProposalCompliance(baseInput({ claims: [{ id: 'c1', supportStatus: 'UNSUPPORTED' }] }))
    expect(outcome.result).toBe('BLOCKED')
    expect(outcome.issues.some((i) => i.code === 'UNSUPPORTED_CLAIM')).toBe(true)
  })

  it('a REQUIRES_REVIEW claim is a WARNING (not a blocker) when nothing else is wrong', () => {
    const outcome = evaluateProposalCompliance(baseInput({ claims: [{ id: 'c1', supportStatus: 'REQUIRES_REVIEW' }] }))
    expect(outcome.result).toBe('REQUIRES_REVIEW')
  })

  it('precedence is BLOCKED > REQUIRES_REVIEW > READY, even when both a blocker and a warning are present', () => {
    const outcome = evaluateProposalCompliance(
      baseInput({
        claims: [{ id: 'c1', supportStatus: 'UNSUPPORTED' }, { id: 'c2', supportStatus: 'REQUIRES_REVIEW' }],
      }),
    )
    expect(outcome.result).toBe('BLOCKED')
  })

  it('a staleness flag always forces BLOCKED, regardless of how complete the proposal otherwise is', () => {
    const outcome = evaluateProposalCompliance(baseInput({ isStale: true, staleReason: 'Requirement changed upstream' }))
    expect(outcome.result).toBe('BLOCKED')
    expect(outcome.issues.some((i) => i.code === 'PROPOSAL_STALE')).toBe(true)
  })

  it('pricing required but not provided is a BLOCKER (never invented)', () => {
    const outcome = evaluateProposalCompliance(baseInput({ pricingRequired: true, pricingProvided: false }))
    expect(outcome.result).toBe('BLOCKED')
    expect(outcome.issues.some((i) => i.code === 'PRICING_REQUIRED')).toBe(true)
  })

  it('is a pure, deterministic function — identical input always produces an identical result', () => {
    const input = baseInput({ requirements: [{ id: 'r1', mandatory: false, coveredBySectionId: 's-exec', coverageStatus: 'PARTIAL' }] })
    const a = evaluateProposalCompliance(input)
    const b = evaluateProposalCompliance(input)
    expect(a).toEqual(b)
  })

  it('evaluation criterion expecting evidence with none linked is a BLOCKER', () => {
    const outcome = evaluateProposalCompliance(baseInput({ evaluations: [{ id: 'e1', coveredBySectionId: 's-exec', coverageStatus: 'COVERED', evidenceExpected: true, evidenceLinked: false }] }))
    expect(outcome.result).toBe('BLOCKED')
    expect(outcome.issues.some((i) => i.code === 'EVALUATION_EVIDENCE_MISSING')).toBe(true)
  })
})
