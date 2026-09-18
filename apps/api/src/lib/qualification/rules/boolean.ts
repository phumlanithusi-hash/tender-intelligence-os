import type { AgencyEvidenceRef, QualificationAction, RuleResult, TenderEvidenceRef } from '../types.js'

export interface BooleanRuleInput {
  mandatory: boolean
  /** null = agency has no verified value for this boolean fact — must resolve to UNKNOWN, never FAIL (Phase 8 §13/§43). */
  value: boolean | null
  agencyEvidence: AgencyEvidenceRef[]
  tenderEvidence: TenderEvidenceRef[]
  trueDescription: string
  falseDescription: string
  unknownDescription: string
  /** When the boolean is false but the tender wording allows a pre-submission remedy (e.g. "register before submission"), pass an action instead of a bare FAIL. */
  falseAction?: QualificationAction
}

/**
 * BOOLEAN rule (Phase 8 §13): CSD registered? tax compliant? required
 * certification held? required registration held? compulsory briefing
 * attended? required insurance available? A `null` value (agency has
 * no verified fact either way) MUST resolve to UNKNOWN — it is never
 * assumed false.
 */
export function evaluateBooleanRule(input: BooleanRuleInput): RuleResult {
  if (input.value === null) {
    return {
      status: 'UNKNOWN',
      mandatory: input.mandatory,
      explanation: input.unknownDescription,
      agencyEvidence: input.agencyEvidence,
      tenderEvidence: input.tenderEvidence,
      evaluatedBy: 'DETERMINISTIC_RULE',
      confidence: null,
      requiresHumanReview: false,
      actions: [],
    }
  }

  if (input.value) {
    return {
      status: 'PASS',
      mandatory: input.mandatory,
      explanation: input.trueDescription,
      agencyEvidence: input.agencyEvidence,
      tenderEvidence: input.tenderEvidence,
      evaluatedBy: 'DETERMINISTIC_RULE',
      confidence: null,
      requiresHumanReview: false,
      actions: [],
    }
  }

  if (input.falseAction) {
    return {
      status: 'REQUIRES_ACTION',
      mandatory: input.mandatory,
      explanation: input.falseDescription,
      agencyEvidence: input.agencyEvidence,
      tenderEvidence: input.tenderEvidence,
      evaluatedBy: 'DETERMINISTIC_RULE',
      confidence: null,
      requiresHumanReview: false,
      actions: [input.falseAction],
    }
  }

  return {
    status: 'FAIL',
    mandatory: input.mandatory,
    explanation: input.falseDescription,
    agencyEvidence: input.agencyEvidence,
    tenderEvidence: input.tenderEvidence,
    evaluatedBy: 'DETERMINISTIC_RULE',
    confidence: null,
    requiresHumanReview: false,
    actions: [],
  }
}
