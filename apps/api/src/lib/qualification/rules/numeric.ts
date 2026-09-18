import type { AgencyEvidenceRef, RuleResult, TenderEvidenceRef } from '../types.js'

export interface NumericRuleInput {
  mandatory: boolean
  /** e.g. 'min turnover', 'min years of experience', 'min references', 'min employees'. */
  label: string
  threshold: number
  /** null = agency has no verified figure — resolves to UNKNOWN, the value is NEVER estimated (Phase 8 §11/§43). */
  agencyValue: number | null
  agencyEvidence: AgencyEvidenceRef[]
  tenderEvidence: TenderEvidenceRef[]
  unit?: string
}

function fmt(n: number, unit?: string): string {
  return unit ? `${n.toLocaleString('en-ZA')} ${unit}` : n.toLocaleString('en-ZA')
}

/** NUMERIC_MIN rule (Phase 8 §11): tender requires at least `threshold`; agency's verified value must meet or exceed it. */
export function evaluateNumericMinRule(input: NumericRuleInput): RuleResult {
  return evaluateNumeric(input, 'min')
}

/** NUMERIC_MAX rule (Phase 8 §5/§10): tender requires no more than `threshold` (e.g. max number of subcontractors, max project age). */
export function evaluateNumericMaxRule(input: NumericRuleInput): RuleResult {
  return evaluateNumeric(input, 'max')
}

function evaluateNumeric(input: NumericRuleInput, direction: 'min' | 'max'): RuleResult {
  const { mandatory, label, threshold, agencyValue, agencyEvidence, tenderEvidence, unit } = input

  if (agencyValue === null) {
    return {
      status: 'UNKNOWN',
      mandatory,
      explanation: `Tender requires ${label} of ${direction === 'min' ? 'at least' : 'no more than'} ${fmt(threshold, unit)}, but the agency has no verified figure on record.`,
      agencyEvidence,
      tenderEvidence,
      evaluatedBy: 'DETERMINISTIC_RULE',
      confidence: null,
      requiresHumanReview: false,
      actions: [],
    }
  }

  const meets = direction === 'min' ? agencyValue >= threshold : agencyValue <= threshold

  if (meets) {
    return {
      status: 'PASS',
      mandatory,
      explanation: `Tender requires ${label} of ${direction === 'min' ? 'at least' : 'no more than'} ${fmt(threshold, unit)}; agency's verified value is ${fmt(agencyValue, unit)}.`,
      agencyEvidence,
      tenderEvidence,
      evaluatedBy: 'DETERMINISTIC_RULE',
      confidence: null,
      requiresHumanReview: false,
      actions: [],
    }
  }

  return {
    status: 'FAIL',
    mandatory,
    explanation: `Tender requires ${label} of ${direction === 'min' ? 'at least' : 'no more than'} ${fmt(threshold, unit)}; agency's verified value is ${fmt(agencyValue, unit)}, which does not meet the requirement.`,
    agencyEvidence,
    tenderEvidence,
    evaluatedBy: 'DETERMINISTIC_RULE',
    confidence: null,
    requiresHumanReview: false,
    actions: [],
  }
}
