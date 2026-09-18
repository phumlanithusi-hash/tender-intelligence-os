import type { SubmissionReadinessInput } from '../types.js'

/**
 * Phase 15 — a fully-satisfied baseline input, mirroring every prior
 * phase's fixtures.ts convention (lib/bidDecision/__tests__/fixtures.ts).
 * Each test in engine.test.ts clones this and flips exactly the
 * dimension it targets.
 */
export function readyBaseline(): SubmissionReadinessInput {
  return {
    nowIso: '2026-09-11T09:00:00Z',
    tenderClosingDate: '2026-10-01',
    tenderClosingTime: '12:00:00',
    qualification: { finalBidDecision: 'BID' },
    requirements: [{ id: 'req-1', mandatory: true, status: 'SATISFIED', description: 'Valid tax clearance' }],
    evaluationCriteria: [{ id: 'crit-1', weight: 40, mandatoryCoverage: false, covered: true }],
    briefings: [],
    addenda: [],
    proposal: {
      exists: true,
      versionId: 'version-1',
      matchesTender: true,
      matchesBidProject: true,
      isCurrentVersion: true,
      isStale: false,
      staleReason: null,
      complianceResult: 'READY_FOR_INTERNAL_REVIEW',
      missingRequiredSections: [],
    },
    evidence: [{ id: 'ev-1', mandatory: true, lifecycle: 'APPROVED_CURRENT' }],
    pricing: {
      required: true,
      provided: true,
      currencyPresent: true,
      lines: [{ id: 'line-1', description: 'Project management', quantityValid: true, unitPriceValid: true, totalMatchesArithmetic: true, currencyPresent: true }],
      mandatoryScheduleRequired: false,
      mandatorySchedulePresent: false,
    },
    documents: [{ id: 'doc-1', name: 'Tax clearance certificate', required: true, status: 'VERIFIED' }],
    forms: [{ id: 'form-1', name: 'SBD 4', required: true, completed: true, signed: true, attached: true }],
    certificates: [{ id: 'cert-1', name: 'B-BBEE certificate', required: true, status: 'VALID' }],
    signatures: [{ id: 'sig-1', name: 'Authorised signatory', status: 'PRESENT' }],
    files: [{ id: 'file-1', fileName: 'Technical_Proposal.pdf', required: true, exists: true, formatValid: true, sizeValid: true, nameResult: 'NO_NAMING_RULE' }],
    submissionMethod: { method: 'PORTAL', instructionsKnown: true },
  }
}
