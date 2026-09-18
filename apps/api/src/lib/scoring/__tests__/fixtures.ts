import { randomUUID } from 'node:crypto'
import type { ScoringInput } from '../types.js'
import { DEFAULT_SCORING_CONFIGURATION } from '../defaultConfig.js'

export const config = DEFAULT_SCORING_CONFIGURATION

/** A fully-known, strong-opportunity baseline (Phase 10 §48 test 1). Individual tests override slices of this to isolate one dimension at a time. */
export function baseInput(overrides: Partial<ScoringInput> = {}): ScoringInput {
  const reqId = randomUUID()
  const criterionId = randomUUID()
  return {
    tenderId: 'tender-1',
    agencyId: 'agency-1',
    now: '2026-09-11T00:00:00.000Z',
    qualification: {
      runId: 'run-1',
      overallStatus: 'ELIGIBLE',
      runUpdatedAt: '2026-09-01T00:00:00Z',
      results: [{ requirementId: reqId, status: 'PASS', mandatory: true, explanation: 'CSD registration verified.', tenderEvidence: [], agencyEvidence: [] }],
    },
    requirements: [{ id: reqId, mandatoryStatus: 'MANDATORY', requirementType: 'ELIGIBILITY', description: 'Must be CSD registered.', version: 1, updatedAt: '2026-09-01T00:00:00Z' }],
    evaluationCriteria: [
      {
        id: criterionId,
        criterion: 'Relevant Experience',
        criterionType: 'FUNCTIONALITY',
        weight: 40,
        gate: false,
        minimumScore: null,
        version: 1,
        updatedAt: '2026-09-01T00:00:00Z',
        linkedEvidence: [
          { criterionId, evidenceType: 'AGENCY_CASE_STUDY', evidenceState: 'VERIFIED', evidenceRef: { kind: 'AGENCY', agencyEvidenceId: 'cs-1', description: null } },
          { criterionId, evidenceType: 'AGENCY_CASE_STUDY', evidenceState: 'VERIFIED', evidenceRef: { kind: 'AGENCY', agencyEvidenceId: 'cs-2', description: null } },
          { criterionId, evidenceType: 'AGENCY_CASE_STUDY', evidenceState: 'VERIFIED', evidenceRef: { kind: 'AGENCY', agencyEvidenceId: 'cs-3', description: null } },
        ],
      },
    ],
    evaluationGates: [],
    agencyEvidence: [
      { id: 'cs-1', kind: 'CASE_STUDY', state: 'VERIFIED', evidenceRef: { kind: 'AGENCY', agencyEvidenceId: 'cs-1', description: null }, updatedAt: '2026-08-01T00:00:00Z' },
      { id: 'cert-1', kind: 'CERTIFICATE', state: 'VERIFIED', evidenceRef: { kind: 'AGENCY', agencyEvidenceId: 'cert-1', description: null }, updatedAt: '2026-08-01T00:00:00Z' },
    ],
    commercial: { estimatedValue: 500000, contractDuration: '12 months', agencyMinProjectValue: 100000 },
    strategic: { strategicProfileKnown: true, targetSectors: ['ICT'], preferredOrgTypes: ['MUNICIPALITY'], strategicCapabilities: [], tenderOrgType: 'MUNICIPALITY', tenderCategory: 'ICT' },
    serviceAlignment: { requiredServiceIds: ['svc-1'], agencyServiceIds: ['svc-1', 'svc-2'], serviceLabels: { 'svc-1': 'Graphic Design' } },
    geography: { tenderScope: [{ scopeType: 'NATIONAL', provinceId: null, municipalityId: null }], agencyScope: [{ scopeType: 'NATIONAL', provinceId: null, municipalityId: null }], agencyGeographyKnown: true },
    briefing: { required: false, attendance: 'UNKNOWN', evidence: [] },
    deadline: { closingDate: '2026-12-01', closingTime: null },
    ...overrides,
  }
}
