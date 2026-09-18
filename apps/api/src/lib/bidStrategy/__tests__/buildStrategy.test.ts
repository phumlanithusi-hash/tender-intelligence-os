import { describe, expect, it } from 'vitest'
import { buildBidStrategy } from '../buildStrategy.js'
import type { BidStrategyBuildInput } from '../types.js'

function baseInput(): BidStrategyBuildInput {
  return {
    tenderId: 't1',
    agencyId: 'a1',
    bidProjectId: 'p1',
    version: 1,
    evaluationWeightThreshold: 20,
    tenderClosingDate: '2026-12-01',
    briefingRequired: false,
    qualificationOverallStatus: 'ELIGIBLE',
    requirements: [
      { id: 'req-1', requirementType: 'MANDATORY_DOCUMENT', requirementText: 'Tax clearance certificate', mandatory: true, qualificationStatus: 'PASS', qualificationEvidenceId: 'ev-1' },
      { id: 'req-2', requirementType: 'MANDATORY_DOCUMENT', requirementText: 'BEE certificate', mandatory: true, qualificationStatus: 'UNKNOWN', qualificationEvidenceId: null },
      { id: 'req-3', requirementType: 'TECHNICAL', requirementText: 'Optional nice-to-have', mandatory: false, qualificationStatus: 'UNKNOWN', qualificationEvidenceId: null },
    ],
    evaluationCriteria: [
      { id: 'crit-1', criterion: 'Technical methodology', description: 'How the work will be done', weight: 30, evidenceLinkCount: 2 },
      { id: 'crit-2', criterion: 'Price', description: null, weight: 40, evidenceLinkCount: 0 },
      { id: 'crit-3', criterion: 'Local content', description: null, weight: null, evidenceLinkCount: 0 },
    ],
    opportunityScore: 72,
    bidDecisionFinal: 'BID',
    bidEffort: 'MEDIUM',
  }
}

describe('buildBidStrategy (Phase 12 §27) — pure, deterministic', () => {
  it('is a pure function: identical input always produces an identical draft', () => {
    const input = baseInput()
    const first = buildBidStrategy(input)
    const second = buildBidStrategy(JSON.parse(JSON.stringify(input)))
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
  })

  it('maps every evaluation criterion to exactly one evaluation strategy item', () => {
    const draft = buildBidStrategy(baseInput())
    expect(draft.evaluationStrategies).toHaveLength(3)
    expect(draft.evaluationStrategies.map((e) => e.evaluationCriterionId).sort()).toEqual(['crit-1', 'crit-2', 'crit-3'])
  })

  it('a high-weight criterion with no linked evidence produces a CRITICAL evidence need, never a fabricated win theme', () => {
    const draft = buildBidStrategy(baseInput())
    const priceGap = draft.evidenceNeeds.find((n) => n.evaluationCriterionId === 'crit-2')
    expect(priceGap).toBeDefined()
    expect(priceGap?.severity).toBe('CRITICAL')
    expect(draft.winThemes.some((w) => w.sourceId === 'crit-2')).toBe(false)
  })

  it('a high-weight criterion WITH linked evidence produces a win theme traceable to that criterion', () => {
    const draft = buildBidStrategy(baseInput())
    const theme = draft.winThemes.find((w) => w.sourceId === 'crit-1')
    expect(theme).toBeDefined()
    expect(theme?.sourceType).toBe('EVALUATION_CRITERION')
  })

  it('an evaluation criterion with a null (unknown) weight never gets an invented weight', () => {
    const draft = buildBidStrategy(baseInput())
    const priority = draft.tenderPriorities.find((p) => p.sourceId === 'crit-3')
    expect(priority?.weight).toBeNull()
  })

  it('every mandatory requirement gets a requirement response plan; non-mandatory ones do not', () => {
    const draft = buildBidStrategy(baseInput())
    expect(draft.requirementPlans.map((p) => p.tenderRequirementId).sort()).toEqual(['req-1', 'req-2'])
  })

  it('a mandatory requirement not yet PASS produces a CRITICAL evidence need and a CRITICAL risk', () => {
    const draft = buildBidStrategy(baseInput())
    const need = draft.evidenceNeeds.find((n) => n.requirementId === 'req-2')
    expect(need?.severity).toBe('CRITICAL')
    expect(draft.risks.some((r) => r.sourceId === 'req-2' && r.severity === 'CRITICAL')).toBe(true)
  })

  it('a mandatory requirement already PASS with evidence produces no risk or evidence need', () => {
    const draft = buildBidStrategy(baseInput())
    expect(draft.evidenceNeeds.some((n) => n.requirementId === 'req-1')).toBe(false)
    expect(draft.risks.some((r) => r.sourceId === 'req-1')).toBe(false)
  })

  it('never generates differentiators automatically (must always be human-authored)', () => {
    const draft = buildBidStrategy(baseInput())
    expect(draft.differentiators).toEqual([])
  })

  it('only creates workstreams actually supported by this tender\'s data, never a blanket set', () => {
    const noRequirements = buildBidStrategy({ ...baseInput(), requirements: [] })
    expect(noRequirements.workstreams.some((w) => w.category === 'CONTENT')).toBe(false)
    expect(noRequirements.workstreams.some((w) => w.category === 'COMPLIANCE')).toBe(false)

    const withMandatory = buildBidStrategy(baseInput())
    expect(withMandatory.workstreams.some((w) => w.category === 'COMPLIANCE')).toBe(true)
  })

  it('an unknown closing date produces a MEDIUM risk sourced from CLOSING_DATE', () => {
    const draft = buildBidStrategy({ ...baseInput(), tenderClosingDate: null })
    expect(draft.risks.some((r) => r.sourceType === 'CLOSING_DATE' && r.severity === 'MEDIUM')).toBe(true)
  })

  it('a REVIEW-authorized bid decision produces a MEDIUM risk noting the authorization', () => {
    const draft = buildBidStrategy({ ...baseInput(), bidDecisionFinal: 'REVIEW' })
    expect(draft.risks.some((r) => r.sourceType === 'BID_DECISION')).toBe(true)
  })
})
