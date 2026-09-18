import { describe, it, expect } from 'vitest'
import { evaluateRequirement } from '../evaluator.js'
import { baseAgency, baseContext, baseRequirement, agencyEvidenceRef } from './fixtures.js'

describe('evaluateRequirement — pure function determinism', () => {
  it('is deterministic: identical inputs produce identical output', () => {
    const req = baseRequirement()
    const agency = baseAgency({ csdStatus: 'REGISTERED', csdEvidence: [agencyEvidenceRef()] })
    const ctx = baseContext()
    const a = evaluateRequirement(req, agency, ctx)
    const b = evaluateRequirement(req, agency, ctx)
    expect(a).toEqual(b)
  })
})

describe('evaluateRequirement — category dispatch', () => {
  it('CSD: PASS when agency is registered', () => {
    const r = evaluateRequirement(baseRequirement({ category: 'CSD' }), baseAgency({ csdStatus: 'REGISTERED', csdEvidence: [agencyEvidenceRef()] }), baseContext())
    expect(r.status).toBe('PASS')
  })

  it('CSD: REQUIRES_ACTION when agency is not registered', () => {
    const r = evaluateRequirement(baseRequirement({ category: 'CSD' }), baseAgency({ csdStatus: 'NOT_REGISTERED' }), baseContext())
    expect(r.status).toBe('REQUIRES_ACTION')
  })

  it('CSD: UNKNOWN when agency CSD status is unknown — being an eTenders-listed tender source never implies agency CSD compliance', () => {
    const r = evaluateRequirement(baseRequirement({ category: 'CSD' }), baseAgency({ csdStatus: 'UNKNOWN' }), baseContext())
    expect(r.status).toBe('UNKNOWN')
  })

  it('TAX: FAIL when agency verified non-compliant', () => {
    const r = evaluateRequirement(baseRequirement({ category: 'TAX' }), baseAgency({ taxCompliant: false }), baseContext())
    expect(r.status).toBe('FAIL')
  })

  it('TAX: UNKNOWN when unverified', () => {
    const r = evaluateRequirement(baseRequirement({ category: 'TAX' }), baseAgency({ taxCompliant: null }), baseContext())
    expect(r.status).toBe('UNKNOWN')
  })

  it('B_BBEE: PASS when agency level is numerically better than or equal to the required level', () => {
    const req = baseRequirement({ category: 'B_BBEE', ruleConfig: { maxLevel: 4 } })
    const r = evaluateRequirement(req, baseAgency({ bbbeeLevel: 2 }), baseContext())
    expect(r.status).toBe('PASS')
  })

  it('B_BBEE: FAIL when agency level is numerically worse than the required level (AI must never reinterpret this as PASS)', () => {
    const req = baseRequirement({ category: 'B_BBEE', ruleConfig: { maxLevel: 4 } })
    const r = evaluateRequirement(req, baseAgency({ bbbeeLevel: 6 }), baseContext())
    expect(r.status).toBe('FAIL')
  })

  it('TURNOVER: min R10m tender vs R12m verified agency turnover -> PASS', () => {
    const req = baseRequirement({ category: 'TURNOVER', ruleType: 'NUMERIC_MIN', ruleConfig: { minTurnover: 10_000_000 } })
    const r = evaluateRequirement(req, baseAgency({ annualTurnover: 12_000_000 }), baseContext())
    expect(r.status).toBe('PASS')
  })

  it('TURNOVER: min R10m tender vs R7m verified agency turnover -> FAIL', () => {
    const req = baseRequirement({ category: 'TURNOVER', ruleType: 'NUMERIC_MIN', ruleConfig: { minTurnover: 10_000_000 } })
    const r = evaluateRequirement(req, baseAgency({ annualTurnover: 7_000_000 }), baseContext())
    expect(r.status).toBe('FAIL')
  })

  it('TURNOVER: unavailable agency turnover -> UNKNOWN, never estimated', () => {
    const req = baseRequirement({ category: 'TURNOVER', ruleType: 'NUMERIC_MIN', ruleConfig: { minTurnover: 10_000_000 } })
    const r = evaluateRequirement(req, baseAgency({ annualTurnover: null }), baseContext())
    expect(r.status).toBe('UNKNOWN')
  })

  it('GEOGRAPHIC: never resolves via province/municipality FK — always UNKNOWN + requiresHumanReview', () => {
    const req = baseRequirement({ category: 'GEOGRAPHIC', ruleType: 'TEXT' })
    const r = evaluateRequirement(req, baseAgency({ geographyText: 'Gauteng office' }), baseContext())
    expect(r.status).toBe('UNKNOWN')
    expect(r.requiresHumanReview).toBe(true)
  })

  it('a requirement with no ruleType routes to manual review (UNKNOWN + requiresHumanReview), never guessed', () => {
    const req = baseRequirement({ ruleType: null })
    const r = evaluateRequirement(req, baseAgency(), baseContext())
    expect(r.status).toBe('UNKNOWN')
    expect(r.requiresHumanReview).toBe(true)
  })

  it('an unimplemented category (e.g. JV_SUBCONTRACTING) routes to manual review rather than a fabricated result', () => {
    const req = baseRequirement({ category: 'JV_SUBCONTRACTING', ruleType: 'COMPOSITE' })
    const r = evaluateRequirement(req, baseAgency(), baseContext())
    expect(r.status).toBe('UNKNOWN')
    expect(r.requiresHumanReview).toBe(true)
  })

  it('mandatoryStatus other than MANDATORY never sets result.mandatory=true (preferential failure cannot become a blocker)', () => {
    const req = baseRequirement({ category: 'TAX', mandatoryStatus: 'PREFERENTIAL' })
    const r = evaluateRequirement(req, baseAgency({ taxCompliant: false }), baseContext())
    expect(r.status).toBe('FAIL')
    expect(r.mandatory).toBe(false)
  })
})
