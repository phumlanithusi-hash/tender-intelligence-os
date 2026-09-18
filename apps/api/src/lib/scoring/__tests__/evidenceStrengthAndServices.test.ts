import { describe, it, expect } from 'vitest'
import { scoreEvidenceStrength } from '../dimensions/evidenceStrength.js'
import { computeServiceAlignment } from '../dimensions/serviceAlignment.js'
import { matchGeography } from '../dimensions/geography.js'
import { baseInput, config } from './fixtures.js'

describe('scoreEvidenceStrength (Phase 10 §14/§15)', () => {
  it('equal-weighted average of the configured evidence state values', () => {
    const input = baseInput({
      agencyEvidence: [
        { id: '1', kind: 'CASE_STUDY', state: 'VERIFIED', evidenceRef: { kind: 'AGENCY', agencyEvidenceId: '1', description: null }, updatedAt: '' },
        { id: '2', kind: 'CERTIFICATE', state: 'EXPIRED', evidenceRef: { kind: 'AGENCY', agencyEvidenceId: '2', description: null }, updatedAt: '' },
        { id: '3', kind: 'DOCUMENT', state: 'UNVERIFIED', evidenceRef: { kind: 'AGENCY', agencyEvidenceId: '3', description: null }, updatedAt: '' },
        { id: '4', kind: 'REFERENCE', state: 'MISSING', evidenceRef: { kind: 'AGENCY', agencyEvidenceId: '4', description: null }, updatedAt: '' },
      ],
    })
    const component = scoreEvidenceStrength(input, config)
    // (1 + 0 + 0.5 + 0) / 4 = 0.375 -> 37.5
    expect(component.score).toBeCloseTo(37.5, 1)
  })

  it('AI confidence is never a factor — the dimension only reads deterministic state, not any confidence field', () => {
    const input = baseInput({ agencyEvidence: [{ id: '1', kind: 'CASE_STUDY', state: 'VERIFIED', evidenceRef: { kind: 'AGENCY', agencyEvidenceId: '1', description: null }, updatedAt: '' }] })
    const component = scoreEvidenceStrength(input, config)
    expect(component.metadata).not.toHaveProperty('confidence')
    expect(component.score).toBe(100)
  })

  it('no evidence records at all → UNKNOWN', () => {
    const component = scoreEvidenceStrength(baseInput({ agencyEvidence: [] }), config)
    expect(component.status).toBe('UNKNOWN')
    expect(component.score).toBeNull()
  })
})

describe('computeServiceAlignment (Phase 10 §19)', () => {
  it('exact-match count, e.g. "3/3 required services supported"', () => {
    const result = computeServiceAlignment({ requiredServiceIds: ['a', 'b', 'c'], agencyServiceIds: ['a', 'b', 'c', 'd'], serviceLabels: {} })
    expect(result.explanation).toContain('3/3 required services supported')
    expect(result.missingServiceIds).toEqual([])
  })

  it('a missing mandatory service is reported by ID, never guessed as a partial match', () => {
    const result = computeServiceAlignment({ requiredServiceIds: ['a', 'b'], agencyServiceIds: ['a'], serviceLabels: { b: 'Video Production' } })
    expect(result.missingServiceIds).toEqual(['b'])
    expect(result.explanation).toContain('Video Production')
  })

  it('no tender services classified yet → UNKNOWN, not a false 0/0 match', () => {
    const result = computeServiceAlignment({ requiredServiceIds: [], agencyServiceIds: ['a'], serviceLabels: {} })
    expect(result.status).toBe('UNKNOWN')
  })
})

describe('matchGeography (Phase 10 §20, carries forward Phase 7/8 textual-geography limitation)', () => {
  it('agency with no recorded geography → UNKNOWN, never assumed MATCH', () => {
    const result = matchGeography({ tenderScope: [{ scopeType: 'PROVINCE', provinceId: 'p1', municipalityId: null }], agencyScope: [], agencyGeographyKnown: false })
    expect(result.status).toBe('UNKNOWN')
  })

  it('national agency coverage matches any tender scope', () => {
    const result = matchGeography({ tenderScope: [{ scopeType: 'PROVINCE', provinceId: 'p1', municipalityId: null }], agencyScope: [{ scopeType: 'NATIONAL', provinceId: null, municipalityId: null }], agencyGeographyKnown: true })
    expect(result.status).toBe('MATCH')
  })

  it('non-overlapping provinces → MISMATCH', () => {
    const result = matchGeography({ tenderScope: [{ scopeType: 'PROVINCE', provinceId: 'p1', municipalityId: null }], agencyScope: [{ scopeType: 'PROVINCE', provinceId: 'p2', municipalityId: null }], agencyGeographyKnown: true })
    expect(result.status).toBe('MISMATCH')
  })
})
