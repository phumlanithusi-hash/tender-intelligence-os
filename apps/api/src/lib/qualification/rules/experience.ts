import type { AgencyEvidenceRef, AgencyExperienceRecord, RuleResult, TenderEvidenceRef } from '../types.js'

export interface ExperienceMatchCriteria {
  serviceId?: string | null
  industry?: string | null
  clientType?: string | null
  projectType?: string | null
  minProjectValue?: number | null
  minYear?: number | null
}

export interface ExperienceRuleInput {
  mandatory: boolean
  minCount: number
  criteria: ExperienceMatchCriteria
  records: AgencyExperienceRecord[]
  tenderEvidence: TenderEvidenceRef[]
  /** True when the tender's "similar" wording requires semantic judgement beyond the defined structured dimensions (Phase 8 §15) — routes to REQUIRES_REVIEW instead of guessing. */
  requiresSemanticJudgement: boolean
}

function matchesStructuredDimensions(record: AgencyExperienceRecord, criteria: ExperienceMatchCriteria): boolean {
  if (record.evidenceStatus === 'UNKNOWN' || record.evidenceStatus === 'UNVERIFIED') return false
  if (criteria.serviceId && record.serviceId !== criteria.serviceId) return false
  if (criteria.industry && record.industry?.toLowerCase() !== criteria.industry.toLowerCase()) return false
  if (criteria.clientType && record.clientType?.toLowerCase() !== criteria.clientType.toLowerCase()) return false
  if (criteria.projectType && record.projectType?.toLowerCase() !== criteria.projectType.toLowerCase()) return false
  if (criteria.minProjectValue != null && (record.projectValue == null || record.projectValue < criteria.minProjectValue)) return false
  if (criteria.minYear != null && (record.year == null || record.year < criteria.minYear)) return false
  return true
}

/**
 * EXPERIENCE rule (Phase 8 §15): min similar projects / years relevant
 * experience / public-sector clients / project value / industry
 * experience. Evaluated deterministically ONLY along the defined
 * matching dimensions (service, industry, client type, project type,
 * value, year) — "similar" is never invented beyond those. When the
 * tender's wording requires semantic interpretation the caller marks
 * `requiresSemanticJudgement: true` and this resolves to
 * REQUIRES_REVIEW with the candidate evidence preserved, never a
 * guessed PASS/FAIL.
 */
export function evaluateExperienceRule(input: ExperienceRuleInput): RuleResult {
  const { mandatory, minCount, criteria, records, tenderEvidence, requiresSemanticJudgement } = input

  const matching = records.filter((r) => matchesStructuredDimensions(r, criteria))
  const agencyEvidence: AgencyEvidenceRef[] = matching.flatMap((r) => r.evidence)

  if (requiresSemanticJudgement) {
    return {
      status: 'UNKNOWN',
      mandatory,
      explanation: `Requires ${minCount} similar project(s); ${matching.length} matched the defined structured dimensions, but the tender's similarity wording requires human judgement beyond those dimensions.`,
      agencyEvidence,
      tenderEvidence,
      evaluatedBy: 'DETERMINISTIC_RULE',
      confidence: null,
      requiresHumanReview: true,
      actions: [],
    }
  }

  if (records.length === 0) {
    return {
      status: 'UNKNOWN',
      mandatory,
      explanation: `Requires at least ${minCount} matching project(s); the agency has no experience records on file to evaluate against.`,
      agencyEvidence: [],
      tenderEvidence,
      evaluatedBy: 'DETERMINISTIC_RULE',
      confidence: null,
      requiresHumanReview: false,
      actions: [],
    }
  }

  if (matching.length >= minCount) {
    return {
      status: 'PASS',
      mandatory,
      explanation: `Requires at least ${minCount} matching project(s); ${matching.length} verified matching case stud${matching.length === 1 ? 'y' : 'ies'} found.`,
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
    explanation: `Requires at least ${minCount} matching project(s); only ${matching.length} verified matching case stud${matching.length === 1 ? 'y' : 'ies'} found.`,
    agencyEvidence,
    tenderEvidence,
    evaluatedBy: 'DETERMINISTIC_RULE',
    confidence: null,
    requiresHumanReview: false,
    actions: [],
  }
}
