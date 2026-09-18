import type { AgencyEvidenceRef, AgencyReferenceRecord, RuleResult, TenderEvidenceRef } from '../types.js'

export interface ReferenceRuleInput {
  mandatory: boolean
  minCount: number
  /** e.g. 5 — references must fall within this many years of `asOf`. */
  periodYears: number | null
  asOf: string // UTC ISO 8601, passed by caller — never read from a clock here.
  clientType?: string | null
  records: AgencyReferenceRecord[]
  tenderEvidence: TenderEvidenceRef[]
  eligibilityUncertain: boolean
}

function withinPeriod(record: AgencyReferenceRecord, periodYears: number | null, asOf: string): boolean {
  if (periodYears === null) return true
  if (!record.periodEnd) return false
  const end = new Date(record.periodEnd).getTime()
  const cutoff = new Date(asOf).getTime() - periodYears * 365.25 * 24 * 60 * 60 * 1000
  if (Number.isNaN(end) || Number.isNaN(cutoff)) return false
  return end >= cutoff
}

/**
 * REFERENCE rule (Phase 8 §16): min references, reference period,
 * client type. Only VERIFIED/INFERRED reference records with an
 * established period count toward eligibility — an unverifiable
 * record never silently counts as eligible.
 */
export function evaluateReferenceRule(input: ReferenceRuleInput): RuleResult {
  const { mandatory, minCount, periodYears, asOf, clientType, records, tenderEvidence, eligibilityUncertain } = input

  const eligible = records.filter((r) => {
    if (r.evidenceStatus === 'UNKNOWN' || r.evidenceStatus === 'UNVERIFIED') return false
    if (clientType && r.clientType?.toLowerCase() !== clientType.toLowerCase()) return false
    return withinPeriod(r, periodYears, asOf)
  })
  const agencyEvidence: AgencyEvidenceRef[] = eligible.flatMap((r) => r.evidence)

  if (eligibilityUncertain) {
    return {
      status: 'REQUIRES_ACTION',
      mandatory,
      explanation: `Requires ${minCount} reference(s); ${eligible.length} appear eligible but eligibility of one or more references could not be conclusively confirmed.`,
      agencyEvidence,
      tenderEvidence,
      evaluatedBy: 'DETERMINISTIC_RULE',
      confidence: null,
      requiresHumanReview: true,
      actions: [{ description: 'Confirm eligibility of uncertain references (contact details, project similarity).', priority: mandatory ? 'HIGH' : 'MEDIUM', dueDate: null }],
    }
  }

  if (records.length === 0) {
    return {
      status: 'UNKNOWN',
      mandatory,
      explanation: `Requires at least ${minCount} reference(s); the agency has no reference records on file.`,
      agencyEvidence: [],
      tenderEvidence,
      evaluatedBy: 'DETERMINISTIC_RULE',
      confidence: null,
      requiresHumanReview: false,
      actions: [],
    }
  }

  if (eligible.length >= minCount) {
    return {
      status: 'PASS',
      mandatory,
      explanation: `Requires at least ${minCount} reference(s); ${eligible.length} verified eligible reference(s) found.`,
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
    explanation: `Requires at least ${minCount} reference(s); only ${eligible.length} verified eligible reference(s) found.`,
    agencyEvidence,
    tenderEvidence,
    evaluatedBy: 'DETERMINISTIC_RULE',
    confidence: null,
    requiresHumanReview: false,
    actions: [],
  }
}
