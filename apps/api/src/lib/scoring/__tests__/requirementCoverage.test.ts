import { describe, it, expect } from 'vitest'
import { scoreRequirementCoverage, classifyRequirementCoverage } from '../dimensions/requirementCoverage.js'
import { baseInput, config } from './fixtures.js'
import type { ScoringInput } from '../types.js'

describe('requirementCoverage — exact formula (Phase 10 §8)', () => {
  it('classifies INFORMATIONAL requirements as NOT_APPLICABLE regardless of any result', () => {
    const c = classifyRequirementCoverage({ id: 'r1', mandatoryStatus: 'INFORMATIONAL', requirementType: 'INFORMATIONAL', description: 'FYI', version: 1, updatedAt: '' }, undefined)
    expect(c.coverageStatus).toBe('NOT_APPLICABLE')
  })

  it('classifies missing qualification result as UNKNOWN, never FAILED', () => {
    const c = classifyRequirementCoverage({ id: 'r1', mandatoryStatus: 'MANDATORY', requirementType: 'ELIGIBILITY', description: 'x', version: 1, updatedAt: '' }, undefined)
    expect(c.coverageStatus).toBe('UNKNOWN')
  })

  it('computes coverage = weighted_supported / weighted_applicable with equal weighting fallback', () => {
    const input = baseInput({
      requirements: [
        { id: 'r1', mandatoryStatus: 'MANDATORY', requirementType: 'ELIGIBILITY', description: 'A', version: 1, updatedAt: '' },
        { id: 'r2', mandatoryStatus: 'MANDATORY', requirementType: 'ELIGIBILITY', description: 'B', version: 1, updatedAt: '' },
        { id: 'r3', mandatoryStatus: 'PREFERENTIAL', requirementType: 'TECHNICAL', description: 'C', version: 1, updatedAt: '' },
        { id: 'r4', mandatoryStatus: 'INFORMATIONAL', requirementType: 'INFORMATIONAL', description: 'D', version: 1, updatedAt: '' },
      ],
      qualification: {
        runId: 'run-1',
        overallStatus: 'ACTION_REQUIRED',
        runUpdatedAt: '',
        results: [
          { requirementId: 'r1', status: 'PASS', mandatory: true, explanation: '', tenderEvidence: [], agencyEvidence: [] },
          { requirementId: 'r2', status: 'REQUIRES_ACTION', mandatory: true, explanation: '', tenderEvidence: [], agencyEvidence: [] },
          { requirementId: 'r3', status: 'UNKNOWN', mandatory: false, explanation: '', tenderEvidence: [], agencyEvidence: [] },
        ],
      },
    })
    const component = scoreRequirementCoverage(input, config)
    // Applicable = r1,r2,r3 (r4 is NOT_APPLICABLE, excluded). Values: SUPPORTED=1, ACTION_REQUIRED=0, UNKNOWN=0. coverage = (1+0+0)/3 = 0.3333 -> 33.33
    expect(component.score).toBeCloseTo(33.33, 1)
    expect(component.metadata.counts).toMatchObject({ SUPPORTED: 1, ACTION_REQUIRED: 1, UNKNOWN: 1, NOT_APPLICABLE: 1 })
  })

  it('a single mandatory FAILED requirement is flagged as a risk even amid many SUPPORTED ones (never hidden by the aggregate)', () => {
    const requirements = Array.from({ length: 9 }, (_, i) => ({ id: `ok-${i}`, mandatoryStatus: 'MANDATORY' as const, requirementType: 'ELIGIBILITY', description: `ok ${i}`, version: 1, updatedAt: '' }))
    requirements.push({ id: 'bad', mandatoryStatus: 'MANDATORY', requirementType: 'ELIGIBILITY', description: 'Tax clearance', version: 1, updatedAt: '' })
    const results: ScoringInput['qualification']['results'] = requirements.slice(0, 9).map((r) => ({ requirementId: r.id, status: 'PASS', mandatory: true, explanation: '', tenderEvidence: [], agencyEvidence: [] }))
    results.push({ requirementId: 'bad', status: 'FAIL', mandatory: true, explanation: 'Tax clearance missing', tenderEvidence: [], agencyEvidence: [] })
    const input = baseInput({ requirements, qualification: { runId: 'run-1', overallStatus: 'NOT_ELIGIBLE', runUpdatedAt: '', results } })
    const component = scoreRequirementCoverage(input, config)
    expect(component.score).toBeCloseTo(90, 0) // 9/10 supported numerically — the aggregate alone would look "HIGH"...
    expect(component.risks.some((r) => r.description.includes('Mandatory requirement failed'))).toBe(true) // ...but the mandatory failure is still surfaced explicitly, and the gate layer (see gates.test.ts) forces BLOCKED regardless.
  })

  it('no requirements at all → UNKNOWN, not a fabricated 0 or 100', () => {
    const input = baseInput({ requirements: [], qualification: { runId: null, overallStatus: null, runUpdatedAt: null, results: [] } })
    const component = scoreRequirementCoverage(input, config)
    expect(component.status).toBe('UNKNOWN')
    expect(component.score).toBeNull()
  })
})
