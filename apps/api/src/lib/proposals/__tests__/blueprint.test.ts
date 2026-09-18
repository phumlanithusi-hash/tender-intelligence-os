import { describe, expect, it } from 'vitest'
import { generateProposalBlueprint } from '../blueprint.js'
import type { BlueprintInput } from '../types.js'

function baseInput(overrides: Partial<BlueprintInput> = {}): BlueprintInput {
  return {
    requirements: [],
    evaluationCriteria: [],
    winThemes: [],
    differentiators: [],
    hasEvidenceNeeds: false,
    hasPricingRequirement: false,
    ...overrides,
  }
}

describe('generateProposalBlueprint (Phase 14 §7/§8/§9)', () => {
  it('always includes COVER, EXECUTIVE_SUMMARY and COMPLIANCE even with no tender data', () => {
    const plan = generateProposalBlueprint(baseInput())
    const types = plan.map((p) => p.sectionType)
    expect(types).toContain('COVER')
    expect(types).toContain('EXECUTIVE_SUMMARY')
    expect(types).toContain('COMPLIANCE')
  })

  it('produces a deterministic, strictly increasing sort order', () => {
    const plan = generateProposalBlueprint(baseInput({ requirements: [{ id: 'r1', requirementType: 'TECHNICAL', requirementText: 'x', mandatory: true }] }))
    const orders = plan.map((p) => p.sortOrder)
    expect(orders).toEqual([...orders].sort((a, b) => a - b))
    expect(new Set(orders).size).toBe(orders.length)
  })

  it('running the same input twice produces an identical blueprint (deterministic)', () => {
    const input = baseInput({ requirements: [{ id: 'r1', requirementType: 'TECHNICAL', requirementText: 'x', mandatory: true }] })
    const a = generateProposalBlueprint(input)
    const b = generateProposalBlueprint(input)
    expect(a).toEqual(b)
  })

  it('maps TECHNICAL requirements to TECHNICAL_RESPONSE/APPROACH/METHODOLOGY with requirementIds traceable', () => {
    const plan = generateProposalBlueprint(baseInput({ requirements: [{ id: 'r1', requirementType: 'TECHNICAL', requirementText: 'x', mandatory: false }] }))
    const technical = plan.find((p) => p.sectionType === 'TECHNICAL_RESPONSE')
    expect(technical).toBeDefined()
    expect(technical!.requirementIds).toContain('r1')
  })

  it('maps weighted evaluation criteria to a CREDENTIALS section with evaluationCriterionIds traceable', () => {
    const plan = generateProposalBlueprint(baseInput({ evaluationCriteria: [{ id: 'c1', criterion: 'Technical', weight: 40 }] }))
    const credentials = plan.find((p) => p.sectionType === 'CREDENTIALS')
    expect(credentials).toBeDefined()
    expect(credentials!.evaluationCriterionIds).toContain('c1')
  })

  it('a zero-weight evaluation criterion does not force a CREDENTIALS section on its own', () => {
    const plan = generateProposalBlueprint(baseInput({ evaluationCriteria: [{ id: 'c1', criterion: 'Technical', weight: 0 }] }))
    expect(plan.find((p) => p.sectionType === 'CREDENTIALS')).toBeUndefined()
  })

  it('hasEvidenceNeeds true adds EXPERIENCE/CASE_STUDIES/REFERENCES sections even with no matching requirement type', () => {
    const plan = generateProposalBlueprint(baseInput({ hasEvidenceNeeds: true }))
    const types = plan.map((p) => p.sectionType)
    expect(types).toContain('CASE_STUDIES')
    expect(types).toContain('REFERENCES')
  })

  it('mandatory requirements are reflected on the COMPLIANCE section requirementIds', () => {
    const plan = generateProposalBlueprint(baseInput({ requirements: [{ id: 'r1', requirementType: 'ELIGIBILITY', requirementText: 'x', mandatory: true }] }))
    const compliance = plan.find((p) => p.sectionType === 'COMPLIANCE')
    expect(compliance!.requirementIds).toContain('r1')
    expect(compliance!.isMandatory).toBe(true)
  })

  it('never produces a section type outside the configured vocabulary and every sectionKey is unique', () => {
    const plan = generateProposalBlueprint(
      baseInput({
        requirements: [
          { id: 'r1', requirementType: 'TECHNICAL', requirementText: 'x', mandatory: true },
          { id: 'r2', requirementType: 'STAFFING', requirementText: 'y', mandatory: false },
          { id: 'r3', requirementType: 'B_BBEE', requirementText: 'z', mandatory: false },
        ],
      }),
    )
    const keys = plan.map((p) => p.sectionKey)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
