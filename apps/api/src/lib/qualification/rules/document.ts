import type { AgencyEvidenceRef, RuleResult, TenderEvidenceRef } from '../types.js'

export interface DocumentRuleInput {
  mandatory: boolean
  label: string
  presence: 'PRESENT_VALID' | 'PRESENT_UNVERIFIABLE' | 'PRESENT_EXPIRED' | 'PRESENT_REJECTED' | 'ABSENT'
  agencyEvidence: AgencyEvidenceRef[]
  tenderEvidence: TenderEvidenceRef[]
}

/**
 * DOCUMENT rule (Phase 8 §14): tender requires proof of some document
 * (e.g. PI insurance, a signed declaration). Absence is NEVER a
 * permanent inability to qualify — it resolves to REQUIRES_ACTION, not
 * FAIL, since the agency may simply need to produce/upload it.
 */
export function evaluateDocumentRule(input: DocumentRuleInput): RuleResult {
  const { mandatory, label, presence, agencyEvidence, tenderEvidence } = input
  const base = { mandatory, agencyEvidence, tenderEvidence, evaluatedBy: 'DETERMINISTIC_RULE' as const, confidence: null }

  switch (presence) {
    case 'PRESENT_VALID':
      return { ...base, status: 'PASS', explanation: `${label} is on record and verified as valid.`, requiresHumanReview: false, actions: [] }
    case 'PRESENT_UNVERIFIABLE':
      return {
        ...base,
        status: 'UNKNOWN',
        explanation: `${label} exists on record but its validity could not be verified.`,
        requiresHumanReview: false,
        actions: [],
      }
    case 'PRESENT_EXPIRED':
      return {
        ...base,
        status: 'REQUIRES_ACTION',
        explanation: `${label} is on record but has expired. Renew it before submission.`,
        requiresHumanReview: false,
        actions: [{ description: `Renew ${label}.`, priority: mandatory ? 'CRITICAL' : 'HIGH', dueDate: null }],
      }
    case 'PRESENT_REJECTED':
      return {
        ...base,
        status: 'REQUIRES_ACTION',
        explanation: `${label} on record was previously rejected/flagged as invalid. Obtain a valid replacement before submission.`,
        requiresHumanReview: true,
        actions: [{ description: `Replace the rejected ${label}.`, priority: 'CRITICAL', dueDate: null }],
      }
    case 'ABSENT':
    default:
      return {
        ...base,
        status: 'REQUIRES_ACTION',
        explanation: `${label} is required but no such document exists on the agency's record. This is a required action, not an automatic disqualification.`,
        requiresHumanReview: false,
        actions: [{ description: `Obtain and upload ${label}.`, priority: mandatory ? 'CRITICAL' : 'MEDIUM', dueDate: null }],
      }
  }
}
