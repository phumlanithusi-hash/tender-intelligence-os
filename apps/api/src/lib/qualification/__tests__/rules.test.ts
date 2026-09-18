import { describe, it, expect } from 'vitest'
import { evaluateBooleanRule } from '../rules/boolean.js'
import { evaluateNumericMinRule, evaluateNumericMaxRule } from '../rules/numeric.js'
import { evaluateDateExpiryRule } from '../rules/date.js'
import { evaluateDocumentRule } from '../rules/document.js'
import { evaluateExperienceRule } from '../rules/experience.js'
import { evaluateReferenceRule } from '../rules/reference.js'
import { evaluateBriefingRule } from '../rules/briefing.js'
import { evaluateEnumRule } from '../rules/enum.js'
import { evaluateCompositeRule } from '../rules/composite.js'
import { tenderEvidence, agencyEvidenceRef } from './fixtures.js'

const te = [tenderEvidence()]

describe('BOOLEAN rule', () => {
  it('PASS when value is true', () => {
    const r = evaluateBooleanRule({ mandatory: true, value: true, agencyEvidence: [agencyEvidenceRef()], tenderEvidence: te, trueDescription: 'yes', falseDescription: 'no', unknownDescription: 'unk' })
    expect(r.status).toBe('PASS')
  })
  it('FAIL when value is false and no remedy action supplied', () => {
    const r = evaluateBooleanRule({ mandatory: true, value: false, agencyEvidence: [], tenderEvidence: te, trueDescription: 'yes', falseDescription: 'no', unknownDescription: 'unk' })
    expect(r.status).toBe('FAIL')
  })
  it('REQUIRES_ACTION when value is false but a remedy action is supplied', () => {
    const r = evaluateBooleanRule({
      mandatory: true,
      value: false,
      agencyEvidence: [],
      tenderEvidence: te,
      trueDescription: 'yes',
      falseDescription: 'no',
      unknownDescription: 'unk',
      falseAction: { description: 'register', priority: 'HIGH', dueDate: null },
    })
    expect(r.status).toBe('REQUIRES_ACTION')
    expect(r.actions).toHaveLength(1)
  })
  it('UNKNOWN when value is null — never collapses to FAIL', () => {
    const r = evaluateBooleanRule({ mandatory: true, value: null, agencyEvidence: [], tenderEvidence: te, trueDescription: 'yes', falseDescription: 'no', unknownDescription: 'unk' })
    expect(r.status).toBe('UNKNOWN')
  })
})

describe('NUMERIC_MIN rule', () => {
  it('PASS when agency value meets threshold (R12m vs R10m)', () => {
    const r = evaluateNumericMinRule({ mandatory: true, label: 'turnover', threshold: 10_000_000, agencyValue: 12_000_000, agencyEvidence: [agencyEvidenceRef()], tenderEvidence: te })
    expect(r.status).toBe('PASS')
  })
  it('FAIL when agency value is below threshold (R7m vs R10m)', () => {
    const r = evaluateNumericMinRule({ mandatory: true, label: 'turnover', threshold: 10_000_000, agencyValue: 7_000_000, agencyEvidence: [agencyEvidenceRef()], tenderEvidence: te })
    expect(r.status).toBe('FAIL')
  })
  it('PASS at exact threshold boundary', () => {
    const r = evaluateNumericMinRule({ mandatory: true, label: 'turnover', threshold: 10_000_000, agencyValue: 10_000_000, agencyEvidence: [], tenderEvidence: te })
    expect(r.status).toBe('PASS')
  })
  it('UNKNOWN when agency value is unavailable — never estimated', () => {
    const r = evaluateNumericMinRule({ mandatory: true, label: 'turnover', threshold: 10_000_000, agencyValue: null, agencyEvidence: [], tenderEvidence: te })
    expect(r.status).toBe('UNKNOWN')
  })
})

describe('NUMERIC_MAX rule', () => {
  it('PASS when value is at or below the max', () => {
    const r = evaluateNumericMaxRule({ mandatory: false, label: 'subcontracted %', threshold: 30, agencyValue: 20, agencyEvidence: [], tenderEvidence: te })
    expect(r.status).toBe('PASS')
  })
  it('FAIL when value exceeds the max', () => {
    const r = evaluateNumericMaxRule({ mandatory: false, label: 'subcontracted %', threshold: 30, agencyValue: 45, agencyEvidence: [], tenderEvidence: te })
    expect(r.status).toBe('FAIL')
  })
})

describe('DATE_EXPIRY rule', () => {
  it('PASS when the document remains valid past the deadline', () => {
    const r = evaluateDateExpiryRule({ mandatory: true, label: 'B-BBEE certificate', mustBeValidUntil: '2026-10-01T00:00:00Z', expiryDate: '2027-01-01T00:00:00Z', documentMissing: false, agencyEvidence: [agencyEvidenceRef()], tenderEvidence: te })
    expect(r.status).toBe('PASS')
  })
  it('REQUIRES_ACTION when the document expires before the deadline (renewal may remedy)', () => {
    const r = evaluateDateExpiryRule({ mandatory: true, label: 'B-BBEE certificate', mustBeValidUntil: '2026-10-01T00:00:00Z', expiryDate: '2026-09-01T00:00:00Z', documentMissing: false, agencyEvidence: [], tenderEvidence: te })
    expect(r.status).toBe('REQUIRES_ACTION')
  })
  it('UNKNOWN when expiry is unverifiable', () => {
    const r = evaluateDateExpiryRule({ mandatory: true, label: 'B-BBEE certificate', mustBeValidUntil: '2026-10-01T00:00:00Z', expiryDate: null, documentMissing: false, agencyEvidence: [], tenderEvidence: te })
    expect(r.status).toBe('UNKNOWN')
  })
  it('REQUIRES_ACTION when the document is entirely missing — never a hard permanent FAIL', () => {
    const r = evaluateDateExpiryRule({ mandatory: true, label: 'B-BBEE certificate', mustBeValidUntil: '2026-10-01T00:00:00Z', expiryDate: null, documentMissing: true, agencyEvidence: [], tenderEvidence: te })
    expect(r.status).toBe('REQUIRES_ACTION')
  })
})

describe('DOCUMENT rule', () => {
  it('PASS when present and valid', () => {
    expect(evaluateDocumentRule({ mandatory: true, label: 'PI insurance', presence: 'PRESENT_VALID', agencyEvidence: [], tenderEvidence: te }).status).toBe('PASS')
  })
  it('UNKNOWN when present but unverifiable', () => {
    expect(evaluateDocumentRule({ mandatory: true, label: 'PI insurance', presence: 'PRESENT_UNVERIFIABLE', agencyEvidence: [], tenderEvidence: te }).status).toBe('UNKNOWN')
  })
  it('REQUIRES_ACTION when absent — never a permanent FAIL', () => {
    expect(evaluateDocumentRule({ mandatory: true, label: 'PI insurance', presence: 'ABSENT', agencyEvidence: [], tenderEvidence: te }).status).toBe('REQUIRES_ACTION')
  })
  it('REQUIRES_ACTION + requiresHumanReview when a rejected document must be replaced', () => {
    const r = evaluateDocumentRule({ mandatory: true, label: 'B-BBEE certificate', presence: 'PRESENT_REJECTED', agencyEvidence: [], tenderEvidence: te })
    expect(r.status).toBe('REQUIRES_ACTION')
    expect(r.requiresHumanReview).toBe(true)
  })
})

describe('EXPERIENCE rule', () => {
  const record = (over: Partial<Parameters<typeof evaluateExperienceRule>[0]['records'][number]> = {}) => ({
    id: 'r1',
    serviceId: 'svc-1',
    industry: 'Construction',
    clientType: 'PUBLIC_SECTOR',
    projectType: 'Roads',
    projectValue: 5_000_000,
    year: 2023,
    geographyText: null,
    evidenceStatus: 'VERIFIED' as const,
    evidence: [agencyEvidenceRef()],
    ...over,
  })

  it('PASS when enough matching verified records exist (3 required, 5 verified matching)', () => {
    const records = Array.from({ length: 5 }, () => record())
    const r = evaluateExperienceRule({ mandatory: true, minCount: 3, criteria: { serviceId: 'svc-1' }, records, tenderEvidence: te, requiresSemanticJudgement: false })
    expect(r.status).toBe('PASS')
  })
  it('FAIL when fewer than required matching records exist', () => {
    const records = [record(), record()]
    const r = evaluateExperienceRule({ mandatory: true, minCount: 3, criteria: { serviceId: 'svc-1' }, records, tenderEvidence: te, requiresSemanticJudgement: false })
    expect(r.status).toBe('FAIL')
  })
  it('UNKNOWN when no experience records exist at all', () => {
    const r = evaluateExperienceRule({ mandatory: true, minCount: 3, criteria: {}, records: [], tenderEvidence: te, requiresSemanticJudgement: false })
    expect(r.status).toBe('UNKNOWN')
  })
  it('unverified records never count toward the match', () => {
    const records = [record({ evidenceStatus: 'UNVERIFIED' }), record({ evidenceStatus: 'UNVERIFIED' }), record({ evidenceStatus: 'UNVERIFIED' })]
    const r = evaluateExperienceRule({ mandatory: true, minCount: 1, criteria: {}, records, tenderEvidence: te, requiresSemanticJudgement: false })
    expect(r.status).toBe('FAIL')
  })
  it('REQUIRES_REVIEW-shaped UNKNOWN when semantic similarity judgement is required', () => {
    const r = evaluateExperienceRule({ mandatory: true, minCount: 3, criteria: {}, records: [record()], tenderEvidence: te, requiresSemanticJudgement: true })
    expect(r.status).toBe('UNKNOWN')
    expect(r.requiresHumanReview).toBe(true)
  })
})

describe('REFERENCE rule', () => {
  const ref = (over: Partial<Parameters<typeof evaluateReferenceRule>[0]['records'][number]> = {}) => ({
    id: 'ref-1',
    isCurrent: true,
    periodStart: '2022-01-01',
    periodEnd: '2024-01-01',
    clientType: 'PUBLIC_SECTOR',
    evidenceStatus: 'VERIFIED' as const,
    evidence: [agencyEvidenceRef()],
    ...over,
  })

  it('FAIL when mandatory and only 2 of 3 required eligible references exist', () => {
    const records = [ref(), ref()]
    const r = evaluateReferenceRule({ mandatory: true, minCount: 3, periodYears: 5, asOf: '2026-01-01T00:00:00Z', records, tenderEvidence: te, eligibilityUncertain: false })
    expect(r.status).toBe('FAIL')
  })
  it('PASS when enough eligible references exist within the period', () => {
    const records = [ref(), ref(), ref()]
    const r = evaluateReferenceRule({ mandatory: true, minCount: 3, periodYears: 5, asOf: '2026-01-01T00:00:00Z', records, tenderEvidence: te, eligibilityUncertain: false })
    expect(r.status).toBe('PASS')
  })
  it('references outside the period do not count', () => {
    const records = [ref({ periodEnd: '2015-01-01' }), ref(), ref()]
    const r = evaluateReferenceRule({ mandatory: true, minCount: 3, periodYears: 5, asOf: '2026-01-01T00:00:00Z', records, tenderEvidence: te, eligibilityUncertain: false })
    expect(r.status).toBe('FAIL')
  })
  it('REQUIRES_ACTION when eligibility is uncertain — never silently PASS or FAIL', () => {
    const r = evaluateReferenceRule({ mandatory: true, minCount: 3, periodYears: 5, asOf: '2026-01-01T00:00:00Z', records: [ref(), ref(), ref()], tenderEvidence: te, eligibilityUncertain: true })
    expect(r.status).toBe('REQUIRES_ACTION')
  })
})

describe('BRIEFING rule', () => {
  it('PASS when attendance is confirmed', () => {
    const r = evaluateBriefingRule({ mandatory: true, briefingRequired: true, briefingDate: '2026-01-01T00:00:00Z', now: '2026-09-11T00:00:00Z', attendance: 'ATTENDED', nonAttendanceEstablishedAsDisqualifying: false, agencyEvidence: [], tenderEvidence: te })
    expect(r.status).toBe('PASS')
  })
  it('REQUIRES_ACTION when the briefing is compulsory and still upcoming', () => {
    const r = evaluateBriefingRule({ mandatory: true, briefingRequired: true, briefingDate: '2026-12-01T00:00:00Z', now: '2026-09-11T00:00:00Z', attendance: 'UNKNOWN', nonAttendanceEstablishedAsDisqualifying: false, agencyEvidence: [], tenderEvidence: te })
    expect(r.status).toBe('REQUIRES_ACTION')
  })
  it('UNKNOWN (not auto-FAIL) when the briefing already occurred with no attendance evidence', () => {
    const r = evaluateBriefingRule({ mandatory: true, briefingRequired: true, briefingDate: '2026-01-01T00:00:00Z', now: '2026-09-11T00:00:00Z', attendance: 'UNKNOWN', nonAttendanceEstablishedAsDisqualifying: false, agencyEvidence: [], tenderEvidence: te })
    expect(r.status).toBe('UNKNOWN')
  })
  it('FAIL only when non-attendance is confirmed AND the tender rules make it explicitly disqualifying', () => {
    const r = evaluateBriefingRule({ mandatory: true, briefingRequired: true, briefingDate: '2026-01-01T00:00:00Z', now: '2026-09-11T00:00:00Z', attendance: 'NOT_ATTENDED', nonAttendanceEstablishedAsDisqualifying: true, agencyEvidence: [], tenderEvidence: te })
    expect(r.status).toBe('FAIL')
  })
  it('NOT_ATTENDED without an explicit disqualifying rule stays UNKNOWN, never auto-FAIL', () => {
    const r = evaluateBriefingRule({ mandatory: true, briefingRequired: true, briefingDate: '2026-01-01T00:00:00Z', now: '2026-09-11T00:00:00Z', attendance: 'NOT_ATTENDED', nonAttendanceEstablishedAsDisqualifying: false, agencyEvidence: [], tenderEvidence: te })
    expect(r.status).toBe('UNKNOWN')
  })
  it('PASS when no briefing is required', () => {
    const r = evaluateBriefingRule({ mandatory: false, briefingRequired: false, briefingDate: null, now: '2026-09-11T00:00:00Z', attendance: 'UNKNOWN', nonAttendanceEstablishedAsDisqualifying: false, agencyEvidence: [], tenderEvidence: te })
    expect(r.status).toBe('PASS')
  })
})

describe('ENUM rule', () => {
  it('PASS when the agency value is in the acceptable set', () => {
    const r = evaluateEnumRule({ mandatory: true, label: 'entity type', acceptableValues: ['EME', 'QSE'], agencyValue: 'QSE', agencyEvidence: [], tenderEvidence: te })
    expect(r.status).toBe('PASS')
  })
  it('FAIL when the agency value is outside the acceptable set', () => {
    const r = evaluateEnumRule({ mandatory: true, label: 'entity type', acceptableValues: ['EME', 'QSE'], agencyValue: 'GENERIC', agencyEvidence: [], tenderEvidence: te })
    expect(r.status).toBe('FAIL')
  })
  it('UNKNOWN when the agency has no verified value', () => {
    const r = evaluateEnumRule({ mandatory: true, label: 'entity type', acceptableValues: ['EME', 'QSE'], agencyValue: null, agencyEvidence: [], tenderEvidence: te })
    expect(r.status).toBe('UNKNOWN')
  })
})

describe('COMPOSITE rule', () => {
  const passResult = evaluateEnumRule({ mandatory: true, label: 'x', acceptableValues: ['A'], agencyValue: 'A', agencyEvidence: [], tenderEvidence: te })
  const failResult = evaluateEnumRule({ mandatory: true, label: 'y', acceptableValues: ['A'], agencyValue: 'B', agencyEvidence: [], tenderEvidence: te })
  const unknownResult = evaluateEnumRule({ mandatory: true, label: 'z', acceptableValues: ['A'], agencyValue: null, agencyEvidence: [], tenderEvidence: te })

  it('FAIL wins if any sub-result FAILs', () => {
    expect(evaluateCompositeRule(true, [passResult, failResult, unknownResult]).status).toBe('FAIL')
  })
  it('UNKNOWN when no FAIL/REQUIRES_ACTION but a sub-result is UNKNOWN', () => {
    expect(evaluateCompositeRule(true, [passResult, unknownResult]).status).toBe('UNKNOWN')
  })
  it('PASS only when every sub-result PASSes', () => {
    expect(evaluateCompositeRule(true, [passResult, passResult]).status).toBe('PASS')
  })
})
