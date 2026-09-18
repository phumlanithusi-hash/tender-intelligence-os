import type { AgencyEvidenceRef, RuleResult, TenderEvidenceRef } from '../types.js'

export interface DateExpiryRuleInput {
  mandatory: boolean
  label: string
  /** UTC ISO 8601 — the date the requirement must remain valid until (e.g. tender closing date, or submission deadline). Never local server time (Phase 8 §12). */
  mustBeValidUntil: string
  /** null = agency has no verified expiry on record. */
  expiryDate: string | null
  /** True only if the agency's document/certificate does not exist at all (vs. exists but expiry unverifiable). */
  documentMissing: boolean
  agencyEvidence: AgencyEvidenceRef[]
  tenderEvidence: TenderEvidenceRef[]
}

/**
 * DATE_EXPIRY rule (Phase 8 §12): certificate expiry, tax validity,
 * registration validity, insurance validity, document validity
 * periods. All comparisons use explicit UTC ISO 8601 timestamps passed
 * in by the caller (EvaluationContext.now / tender closing date) —
 * never a local server clock read inside this pure function.
 */
export function evaluateDateExpiryRule(input: DateExpiryRuleInput): RuleResult {
  const { mandatory, label, mustBeValidUntil, expiryDate, documentMissing, agencyEvidence, tenderEvidence } = input

  if (documentMissing) {
    return {
      status: 'REQUIRES_ACTION',
      mandatory,
      explanation: `${label} is required to remain valid until ${mustBeValidUntil}, but the agency has no such document on record. Provide or obtain it before submission.`,
      agencyEvidence,
      tenderEvidence,
      evaluatedBy: 'DETERMINISTIC_RULE',
      confidence: null,
      requiresHumanReview: false,
      actions: [{ description: `Obtain or upload ${label} before submission.`, priority: mandatory ? 'CRITICAL' : 'MEDIUM', dueDate: mustBeValidUntil }],
    }
  }

  if (expiryDate === null) {
    return {
      status: 'UNKNOWN',
      mandatory,
      explanation: `${label} must remain valid until ${mustBeValidUntil}, but its validity/expiry could not be verified from agency records.`,
      agencyEvidence,
      tenderEvidence,
      evaluatedBy: 'DETERMINISTIC_RULE',
      confidence: null,
      requiresHumanReview: false,
      actions: [],
    }
  }

  const expires = new Date(expiryDate).getTime()
  const deadline = new Date(mustBeValidUntil).getTime()

  if (Number.isNaN(expires) || Number.isNaN(deadline)) {
    return {
      status: 'UNKNOWN',
      mandatory,
      explanation: `${label} has an unparsable date and could not be evaluated against the ${mustBeValidUntil} deadline.`,
      agencyEvidence,
      tenderEvidence,
      evaluatedBy: 'DETERMINISTIC_RULE',
      confidence: null,
      requiresHumanReview: false,
      actions: [],
    }
  }

  if (expires >= deadline) {
    return {
      status: 'PASS',
      mandatory,
      explanation: `${label} is valid until ${expiryDate}, which covers the required date of ${mustBeValidUntil}.`,
      agencyEvidence,
      tenderEvidence,
      evaluatedBy: 'DETERMINISTIC_RULE',
      confidence: null,
      requiresHumanReview: false,
      actions: [],
    }
  }

  // Expired before the required date — a renewal completed before
  // submission could still satisfy the tender, so this is
  // REQUIRES_ACTION rather than an automatic hard FAIL when the
  // requirement is not otherwise established as strictly
  // non-remediable; the caller decides via `mandatory` + `hardFail`
  // wording in ruleConfig (evaluator.ts), this module never invents
  // that distinction itself.
  return {
    status: 'REQUIRES_ACTION',
    mandatory,
    explanation: `${label} expired/expires on ${expiryDate}, before the required date of ${mustBeValidUntil}. Renewal is required before submission.`,
    agencyEvidence,
    tenderEvidence,
    evaluatedBy: 'DETERMINISTIC_RULE',
    confidence: null,
    requiresHumanReview: false,
    actions: [{ description: `Renew ${label} before ${mustBeValidUntil}.`, priority: mandatory ? 'CRITICAL' : 'HIGH', dueDate: mustBeValidUntil }],
  }
}

/** DATE rule (Phase 8 §12): a plain date fact check (e.g. briefing date already occurred vs. still upcoming) with no expiry semantics. */
export function compareDates(a: string, b: string): -1 | 0 | 1 | null {
  const ta = new Date(a).getTime()
  const tb = new Date(b).getTime()
  if (Number.isNaN(ta) || Number.isNaN(tb)) return null
  if (ta < tb) return -1
  if (ta > tb) return 1
  return 0
}
