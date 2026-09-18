import type { AgencyEvidenceSnapshot, EvaluationContext, QualificationRequirement, TenderEvidenceRef } from '../types.js'

export function tenderEvidence(overrides: Partial<TenderEvidenceRef> = {}): TenderEvidenceRef {
  return {
    kind: 'TENDER',
    documentId: '11111111-1111-1111-1111-111111111111',
    documentVersionId: '22222222-2222-2222-2222-222222222222',
    sectionId: null,
    chunkId: '33333333-3333-3333-3333-333333333333',
    pageId: null,
    pageNumber: 3,
    evidenceText: 'Bidders must be registered on the CSD.',
    ...overrides,
  }
}

export function baseRequirement(overrides: Partial<QualificationRequirement> = {}): QualificationRequirement {
  return {
    id: 'req-1',
    tenderId: 'tender-1',
    category: 'CSD',
    description: 'Bidder must be registered on the Central Supplier Database.',
    mandatoryStatus: 'MANDATORY',
    ruleType: 'BOOLEAN',
    ruleConfig: {},
    requirementStatus: 'VERIFIED',
    tenderEvidence: [tenderEvidence()],
    ...overrides,
  }
}

export function baseAgency(overrides: Partial<AgencyEvidenceSnapshot> = {}): AgencyEvidenceSnapshot {
  return {
    agencyId: 'agency-1',
    csdStatus: 'UNKNOWN',
    csdEvidence: [],
    taxCompliant: null,
    taxExpiry: null,
    taxEvidence: [],
    bbbeeLevel: null,
    bbbeeEvidence: [],
    registrationStatus: 'UNKNOWN',
    registrationEvidence: [],
    yearsInBusiness: null,
    yearsInBusinessEvidence: [],
    annualTurnover: null,
    turnoverEvidence: [],
    certificates: [],
    documents: [],
    experienceRecords: [],
    referenceRecords: [],
    keyPersonnelCount: null,
    keyPersonnelEvidence: [],
    briefingAttendance: 'UNKNOWN',
    briefingAttendanceEvidence: [],
    geographyText: null,
    geographyEvidence: [],
    ...overrides,
  }
}

export function baseContext(overrides: Partial<EvaluationContext> = {}): EvaluationContext {
  return {
    now: '2026-09-11T00:00:00.000Z',
    tenderClosingDate: '2026-10-01T12:00:00.000Z',
    briefingDate: null,
    briefingRequired: null,
    ...overrides,
  }
}

export const agencyEvidenceRef = (id = 'ae-1') => ({ kind: 'AGENCY' as const, agencyEvidenceId: id, description: null })
