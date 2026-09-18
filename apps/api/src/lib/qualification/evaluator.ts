import type { AgencyEvidenceSnapshot, EvaluationContext, QualificationRequirement, RuleResult } from './types.js'
import { evaluateBooleanRule } from './rules/boolean.js'
import { evaluateNumericMinRule, evaluateNumericMaxRule } from './rules/numeric.js'
import { evaluateDateExpiryRule } from './rules/date.js'
import { evaluateDocumentRule } from './rules/document.js'
import { evaluateExperienceRule } from './rules/experience.js'
import { evaluateReferenceRule } from './rules/reference.js'
import { evaluateBriefingRule } from './rules/briefing.js'
import { evaluateEnumRule } from './rules/enum.js'

/**
 * Rule engine entry point (Phase 8 §10). Pure function: identical
 * (requirement, agency, context) in ALWAYS produces an identical
 * `RuleResult` out — no hidden I/O, no clock reads, no randomness.
 * Category picks WHICH slice of the agency evidence snapshot is
 * relevant; ruleType (when present) picks the comparison shape;
 * ruleConfig supplies thresholds/parameters. A requirement with no
 * ruleType, or a category this engine does not yet implement a
 * deterministic check for, resolves to UNKNOWN with
 * `requiresHumanReview: true` rather than guessing — this is the
 * MANUAL_REVIEW rule type's behaviour and also the safe fallback.
 */
export function evaluateRequirement(
  requirement: QualificationRequirement,
  agency: AgencyEvidenceSnapshot,
  context: EvaluationContext,
): RuleResult {
  const mandatory = requirement.mandatoryStatus === 'MANDATORY'
  const cfg = requirement.ruleConfig ?? {}
  const num = (key: string): number | null => (typeof cfg[key] === 'number' ? (cfg[key] as number) : null)
  const str = (key: string): string | null => (typeof cfg[key] === 'string' ? (cfg[key] as string) : null)

  const manualReview = (reason: string): RuleResult => ({
    status: 'UNKNOWN',
    mandatory,
    explanation: reason,
    agencyEvidence: [],
    tenderEvidence: requirement.tenderEvidence,
    evaluatedBy: 'DETERMINISTIC_RULE',
    confidence: null,
    requiresHumanReview: true,
    actions: [],
  })

  if (requirement.ruleType === 'MANUAL_REVIEW' || requirement.ruleType === null) {
    return manualReview(`"${requirement.description}" requires manual review — no deterministic rule configuration is available for this requirement.`)
  }

  switch (requirement.category) {
    case 'CSD': {
      const value = agency.csdStatus === 'REGISTERED' ? true : agency.csdStatus === 'NOT_REGISTERED' ? false : null
      return evaluateBooleanRule({
        mandatory,
        value,
        agencyEvidence: agency.csdEvidence,
        tenderEvidence: requirement.tenderEvidence,
        trueDescription: 'Agency is verified as registered on the Central Supplier Database (CSD).',
        falseDescription: 'Agency is verified as NOT registered on the Central Supplier Database (CSD).',
        unknownDescription: 'Agency CSD registration status could not be verified. Being listed as a tender source does not itself establish agency CSD compliance.',
        falseAction: { description: 'Register on the Central Supplier Database (CSD).', priority: mandatory ? 'CRITICAL' : 'MEDIUM', dueDate: context.tenderClosingDate },
      })
    }

    case 'TAX': {
      const nowMs = new Date(context.now).getTime()
      const expiryMs = agency.taxExpiry ? new Date(agency.taxExpiry).getTime() : null
      const stillValidAtClosing = context.tenderClosingDate
        ? evaluateDateExpiryRule({
            mandatory,
            label: 'Tax compliance status',
            mustBeValidUntil: context.tenderClosingDate,
            expiryDate: agency.taxExpiry,
            documentMissing: agency.taxCompliant === null && agency.taxExpiry === null,
            agencyEvidence: agency.taxEvidence,
            tenderEvidence: requirement.tenderEvidence,
          })
        : null
      if (agency.taxCompliant === null) {
        return manualReviewLikeUnknown('Agency tax compliance status could not be verified.', agency.taxEvidence, requirement.tenderEvidence, mandatory)
      }
      if (!agency.taxCompliant) {
        return evaluateBooleanRule({
          mandatory,
          value: false,
          agencyEvidence: agency.taxEvidence,
          tenderEvidence: requirement.tenderEvidence,
          trueDescription: '',
          falseDescription: 'Agency is verified as NOT currently tax compliant.',
          unknownDescription: '',
        })
      }
      if (stillValidAtClosing && stillValidAtClosing.status !== 'PASS' && agency.taxExpiry) {
        return stillValidAtClosing
      }
      void nowMs
      void expiryMs
      return evaluateBooleanRule({
        mandatory,
        value: true,
        agencyEvidence: agency.taxEvidence,
        tenderEvidence: requirement.tenderEvidence,
        trueDescription: 'Agency is verified as tax compliant.',
        falseDescription: '',
        unknownDescription: '',
      })
    }

    case 'B_BBEE': {
      const requiredLevel = num('maxLevel') // "Level 4 or better" -> maxLevel: 4 (lower number is better)
      if (requiredLevel === null) return manualReview('B-BBEE requirement could not be interpreted into a comparable level threshold.')
      if (agency.bbbeeLevel === null) {
        return manualReviewLikeUnknown(`Requires B-BBEE Level ${requiredLevel} or better; agency has no verified B-BBEE level on record.`, agency.bbbeeEvidence, requirement.tenderEvidence, mandatory, false)
      }
      const pass = agency.bbbeeLevel <= requiredLevel
      return {
        status: pass ? 'PASS' : 'FAIL',
        mandatory,
        explanation: `Requires B-BBEE Level ${requiredLevel} or better (eligibility, not preference points); agency's verified level is ${agency.bbbeeLevel}.`,
        agencyEvidence: agency.bbbeeEvidence,
        tenderEvidence: requirement.tenderEvidence,
        evaluatedBy: 'DETERMINISTIC_RULE',
        confidence: null,
        requiresHumanReview: false,
        actions: [],
      }
    }

    case 'COMPANY_REGISTRATION':
      return evaluateBooleanRule({
        mandatory,
        value: agency.registrationStatus === 'VERIFIED' ? true : agency.registrationStatus === 'UNVERIFIED' ? false : null,
        agencyEvidence: agency.registrationEvidence,
        tenderEvidence: requirement.tenderEvidence,
        trueDescription: 'Agency company registration is verified.',
        falseDescription: 'Agency company registration could not be verified as valid.',
        unknownDescription: 'Agency company registration status is unknown.',
      })

    case 'YEARS_IN_BUSINESS': {
      const threshold = num('minYears')
      if (threshold === null) return manualReview('Years-in-business requirement has no configured minimum.')
      return evaluateNumericMinRule({
        mandatory,
        label: 'years in business',
        threshold,
        agencyValue: agency.yearsInBusiness,
        agencyEvidence: agency.yearsInBusinessEvidence,
        tenderEvidence: requirement.tenderEvidence,
        unit: 'years',
      })
    }

    case 'TURNOVER': {
      const threshold = num('minTurnover')
      if (threshold === null) return manualReview('Turnover requirement has no configured minimum.')
      return evaluateNumericMinRule({
        mandatory,
        label: 'annual turnover',
        threshold,
        agencyValue: agency.annualTurnover,
        agencyEvidence: agency.turnoverEvidence,
        tenderEvidence: requirement.tenderEvidence,
        unit: str('currency') ?? 'ZAR',
      })
    }

    case 'RELEVANT_EXPERIENCE': {
      const minCount = num('minCount') ?? 1
      return evaluateExperienceRule({
        mandatory,
        minCount,
        criteria: {
          serviceId: str('serviceId'),
          industry: str('industry'),
          clientType: str('clientType'),
          projectType: str('projectType'),
          minProjectValue: num('minProjectValue'),
          minYear: num('minYear'),
        },
        records: agency.experienceRecords,
        tenderEvidence: requirement.tenderEvidence,
        requiresSemanticJudgement: cfg.requiresSemanticJudgement === true,
      })
    }

    case 'REFERENCES': {
      const minCount = num('minCount') ?? 1
      return evaluateReferenceRule({
        mandatory,
        minCount,
        periodYears: num('periodYears'),
        asOf: context.now,
        clientType: str('clientType'),
        records: agency.referenceRecords,
        tenderEvidence: requirement.tenderEvidence,
        eligibilityUncertain: cfg.eligibilityUncertain === true,
      })
    }

    case 'PROFESSIONAL_REGISTRATION':
    case 'CERTIFICATION':
    case 'INSURANCE': {
      const certType = str('certificateType')
      const cert = certType ? agency.certificates.find((c) => c.certificateType.toLowerCase() === certType.toLowerCase()) : agency.certificates[0]
      if (!cert) {
        return evaluateDocumentRule({
          mandatory,
          label: certType ?? requirement.category,
          presence: 'ABSENT',
          agencyEvidence: [],
          tenderEvidence: requirement.tenderEvidence,
        })
      }
      const mustBeValidUntil = context.tenderClosingDate
      if (mustBeValidUntil && cert.expiryDate) {
        return evaluateDateExpiryRule({
          mandatory,
          label: cert.certificateType,
          mustBeValidUntil,
          expiryDate: cert.expiryDate,
          documentMissing: false,
          agencyEvidence: cert.evidence,
          tenderEvidence: requirement.tenderEvidence,
        })
      }
      return evaluateDocumentRule({
        mandatory,
        label: cert.certificateType,
        presence:
          cert.lifecycleStatus === 'VALID'
            ? 'PRESENT_VALID'
            : cert.lifecycleStatus === 'EXPIRED'
              ? 'PRESENT_EXPIRED'
              : cert.lifecycleStatus === 'REJECTED'
                ? 'PRESENT_REJECTED'
                : cert.lifecycleStatus === 'MISSING'
                  ? 'ABSENT'
                  : 'PRESENT_UNVERIFIABLE',
        agencyEvidence: cert.evidence,
        tenderEvidence: requirement.tenderEvidence,
      })
    }

    case 'KEY_PERSONNEL': {
      const minCount = num('minCount')
      if (minCount === null) return manualReview('Key personnel requirement has no configured minimum count.')
      return evaluateNumericMinRule({
        mandatory,
        label: 'key personnel',
        threshold: minCount,
        agencyValue: agency.keyPersonnelCount,
        agencyEvidence: agency.keyPersonnelEvidence,
        tenderEvidence: requirement.tenderEvidence,
      })
    }

    case 'COMPULSORY_BRIEFING':
      return evaluateBriefingRule({
        mandatory,
        briefingRequired: context.briefingRequired,
        briefingDate: context.briefingDate,
        now: context.now,
        attendance: agency.briefingAttendance,
        nonAttendanceEstablishedAsDisqualifying: cfg.nonAttendanceDisqualifying === true,
        agencyEvidence: agency.briefingAttendanceEvidence,
        tenderEvidence: requirement.tenderEvidence,
      })

    case 'GEOGRAPHIC': {
      // Deliberately textual/UNKNOWN-safe — no province/municipality FK
      // resolution is built here (Phase 7/Phase 8 §21/§42 carried
      // forward technical debt). Eligibility is never inferred merely
      // from an agency's address.
      return manualReviewLikeUnknown(
        `Geographic requirement ("${requirement.description}") cannot be resolved deterministically without province/municipality matching, which is out of scope for this phase. Agency office/service-area text on file: ${agency.geographyText ?? 'none recorded'}.`,
        agency.geographyEvidence,
        requirement.tenderEvidence,
        mandatory,
        true,
      )
    }

    case 'JV_SUBCONTRACTING':
    case 'MANDATORY_FORM':
    case 'DECLARATION':
    case 'SIGNATURE':
    case 'SUBMISSION':
    case 'EQUIPMENT':
    case 'CAPACITY':
    case 'FINANCIAL':
    case 'OTHER':
    case 'UNKNOWN':
    default:
      return manualReview(
        `"${requirement.description}" (category: ${requirement.category}) does not yet have a deterministic evaluator in this phase and requires human review.`,
      )
  }
}

function manualReviewLikeUnknown(
  explanation: string,
  agencyEvidence: RuleResult['agencyEvidence'],
  tenderEvidence: RuleResult['tenderEvidence'],
  mandatory: boolean,
  requiresHumanReview = false,
): RuleResult {
  return {
    status: 'UNKNOWN',
    mandatory,
    explanation,
    agencyEvidence,
    tenderEvidence,
    evaluatedBy: 'DETERMINISTIC_RULE',
    confidence: null,
    requiresHumanReview,
    actions: [],
  }
}

// Re-export the max-numeric rule for consumers that need it directly
// (e.g. a MAX-shaped requirement authored via ruleType NUMERIC_MAX).
export { evaluateNumericMaxRule }
export { evaluateEnumRule }
