import type { AgencyEvidenceRef, RuleResult, TenderEvidenceRef } from '../types.js'

export interface EnumRuleInput {
  mandatory: boolean
  label: string
  /** The set of values that satisfy the requirement, e.g. B-BBEE levels 1-4 for a "Level 4 or better" requirement. */
  acceptableValues: string[]
  /** null = agency has no verified value. */
  agencyValue: string | null
  agencyEvidence: AgencyEvidenceRef[]
  tenderEvidence: TenderEvidenceRef[]
}

/**
 * ENUM rule (Phase 8 §5/§10) — e.g. B-BBEE level thresholds, EME/QSE/
 * generic enterprise category. Kept distinct from a numeric
 * comparison since the "acceptable set" is not always a simple
 * min/max (e.g. accepted document types).
 */
export function evaluateEnumRule(input: EnumRuleInput): RuleResult {
  const { mandatory, label, acceptableValues, agencyValue, agencyEvidence, tenderEvidence } = input
  const base = { mandatory, agencyEvidence, tenderEvidence, evaluatedBy: 'DETERMINISTIC_RULE' as const, confidence: null }

  if (agencyValue === null) {
    return { ...base, status: 'UNKNOWN', explanation: `${label} requires one of [${acceptableValues.join(', ')}]; the agency has no verified value on record.`, requiresHumanReview: false, actions: [] }
  }

  const matches = acceptableValues.some((v) => v.toLowerCase() === agencyValue.toLowerCase())
  if (matches) {
    return { ...base, status: 'PASS', explanation: `${label} requires one of [${acceptableValues.join(', ')}]; agency's verified value is "${agencyValue}".`, requiresHumanReview: false, actions: [] }
  }

  return { ...base, status: 'FAIL', explanation: `${label} requires one of [${acceptableValues.join(', ')}]; agency's verified value is "${agencyValue}", which does not satisfy the requirement.`, requiresHumanReview: false, actions: [] }
}
