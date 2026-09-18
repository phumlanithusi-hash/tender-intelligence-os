import { describe, expect, it } from 'vitest'
import { computeStructuralHash, diffTenderFacts, buildImpactAssessment, type TenderComparableFacts } from '../diffEngine.js'

function facts(overrides: Partial<TenderComparableFacts> = {}): TenderComparableFacts {
  return {
    title: 'Provincial fleet maintenance',
    organisation: 'Dept of Public Works',
    tenderNumber: 'RFB-2026-001',
    closingDate: '2026-10-01',
    rawMetadata: {
      briefingDate: '2026-09-15',
      briefingRequired: true,
      scopeSummary: 'Maintain provincial vehicle fleet.',
      requirementsSummary: 'CIDB grading 5GB required.',
      evaluationSummary: '80/20 price-quality',
      pricingSummary: 'Fixed-price schedule.',
      mandatoryDocuments: ['Tax clearance', 'CIDB certificate'],
    },
    ...overrides,
  }
}

describe('computeStructuralHash', () => {
  it('is deterministic for identical facts', () => {
    expect(computeStructuralHash(facts())).toBe(computeStructuralHash(facts()))
  })

  it('changes when any comparable field changes', () => {
    expect(computeStructuralHash(facts())).not.toBe(computeStructuralHash(facts({ closingDate: '2026-11-01' })))
  })

  it('is stable regardless of mandatoryDocuments array order', () => {
    const a = facts({ rawMetadata: { ...facts().rawMetadata!, mandatoryDocuments: ['A', 'B'] } })
    const b = facts({ rawMetadata: { ...facts().rawMetadata!, mandatoryDocuments: ['B', 'A'] } })
    expect(computeStructuralHash(a)).toBe(computeStructuralHash(b))
  })
})

describe('diffTenderFacts', () => {
  it('reports no material change for identical facts', () => {
    const diff = diffTenderFacts(facts(), facts())
    expect(diff.isMaterial).toBe(false)
    expect(diff.changedFields).toEqual([])
  })

  it('detects a deadline change', () => {
    const diff = diffTenderFacts(facts(), facts({ closingDate: '2026-11-15' }))
    expect(diff.deadlineChanged).toBe(true)
    expect(diff.isMaterial).toBe(true)
    expect(diff.changedFields).toContain('closingDate')
  })

  it('detects a briefing date change', () => {
    const diff = diffTenderFacts(facts(), facts({ rawMetadata: { ...facts().rawMetadata!, briefingDate: '2026-09-20' } }))
    expect(diff.briefingChanged).toBe(true)
    expect(diff.deadlineChanged).toBe(false)
  })

  it('detects a mandatory document requirement change', () => {
    const diff = diffTenderFacts(facts(), facts({ rawMetadata: { ...facts().rawMetadata!, mandatoryDocuments: ['Tax clearance', 'CIDB certificate', 'BEE certificate'] } }))
    expect(diff.requirementChanged).toBe(true)
  })

  it('detects an evaluation criteria change', () => {
    const diff = diffTenderFacts(facts(), facts({ rawMetadata: { ...facts().rawMetadata!, evaluationSummary: '90/10 price-quality' } }))
    expect(diff.evaluationChanged).toBe(true)
  })

  it('detects a pricing structure change', () => {
    const diff = diffTenderFacts(facts(), facts({ rawMetadata: { ...facts().rawMetadata!, pricingSummary: 'Rate-card pricing.' } }))
    expect(diff.pricingChanged).toBe(true)
  })

  it('detects multiple simultaneous changes', () => {
    const diff = diffTenderFacts(facts(), facts({ closingDate: '2026-12-01', rawMetadata: { ...facts().rawMetadata!, pricingSummary: 'Rate-card pricing.' } }))
    expect(diff.deadlineChanged).toBe(true)
    expect(diff.pricingChanged).toBe(true)
    expect(diff.changedFields).toHaveLength(2)
  })

  it('never reports a change when the previous value was unknown (an enrichment, not an addendum)', () => {
    const previousUnknown = facts({ closingDate: null })
    const diff = diffTenderFacts(previousUnknown, facts({ closingDate: '2026-10-01' }))
    expect(diff.deadlineChanged).toBe(false)
    expect(diff.isMaterial).toBe(false)
  })

  it('never reports a change when the incoming scan simply lacks the field this time (never assumes a disappearance is a change)', () => {
    const diff = diffTenderFacts(facts(), facts({ closingDate: null }))
    expect(diff.deadlineChanged).toBe(false)
  })
})

describe('buildImpactAssessment', () => {
  it('flags SUBMISSION_TIMELINE and requires re-acknowledgement for a deadline change', () => {
    const diff = diffTenderFacts(facts(), facts({ closingDate: '2026-11-01' }))
    const impact = buildImpactAssessment(diff)
    expect(impact.affectedAreas).toContain('SUBMISSION_TIMELINE')
    expect(impact.requiresReacknowledgement).toBe(true)
  })

  it('never requires re-acknowledgement when nothing material changed', () => {
    const diff = diffTenderFacts(facts(), facts())
    const impact = buildImpactAssessment(diff)
    expect(impact.affectedAreas).toEqual([])
    expect(impact.requiresReacknowledgement).toBe(false)
  })

  it('flags PRICING_STRUCTURE and COMPLIANCE_REQUIREMENTS independently for their respective changes', () => {
    const diff = diffTenderFacts(
      facts(),
      facts({ rawMetadata: { ...facts().rawMetadata!, pricingSummary: 'New pricing.', requirementsSummary: 'New requirement.' } }),
    )
    const impact = buildImpactAssessment(diff)
    expect(impact.affectedAreas).toEqual(expect.arrayContaining(['PRICING_STRUCTURE', 'COMPLIANCE_REQUIREMENTS']))
  })
})
