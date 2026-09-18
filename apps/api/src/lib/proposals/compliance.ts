import type { ProposalComplianceResult } from '@tender-os/constants'
import type { ComplianceInput, ComplianceIssue, ComplianceOutcome } from './types.js'
import { computeProposalCoverageScore } from './coverageScore.js'

/**
 * Phase 14 §21/§22 — PURE, zero-I/O, deterministic compliance engine.
 * NOT an LLM decision (binding constraint). Precedence is always
 * BLOCKED > REQUIRES_REVIEW > READY_FOR_INTERNAL_REVIEW: a proposal
 * can be arbitrarily complete and still BLOCKED by a single mandatory
 * unresolved issue, mirroring lib/bidStrategy/readiness.ts exactly.
 * This is proposal readiness only — Phase 11 remains authoritative for
 * Bid/No-Bid, Phase 12 for strategy/readiness (spec §22).
 */
export function evaluateProposalCompliance(input: ComplianceInput): ComplianceOutcome {
  const issues: ComplianceIssue[] = []
  const blocker = (code: string, message: string, extra: Partial<Pick<ComplianceIssue, 'sectionId' | 'requirementId' | 'evaluationCriterionId'>> = {}) =>
    issues.push({ code, message, severity: 'BLOCKER', sectionId: extra.sectionId ?? null, requirementId: extra.requirementId ?? null, evaluationCriterionId: extra.evaluationCriterionId ?? null })
  const warning = (code: string, message: string, extra: Partial<Pick<ComplianceIssue, 'sectionId' | 'requirementId' | 'evaluationCriterionId'>> = {}) =>
    issues.push({ code, message, severity: 'WARNING', sectionId: extra.sectionId ?? null, requirementId: extra.requirementId ?? null, evaluationCriterionId: extra.evaluationCriterionId ?? null })

  // --- Structure: required section types present (Phase 14 §21 "Structure"). ---
  for (const requiredType of input.requiredSectionTypesPresent) {
    if (!input.sections.some((s) => s.sectionType === requiredType)) {
      blocker('REQUIRED_SECTION_MISSING', `A required section type (${requiredType}) is missing from this proposal version.`)
    }
  }
  for (const expectedType of input.expectedSectionTypes) {
    if (!input.sections.some((s) => s.sectionType === expectedType)) {
      warning('EXPECTED_SECTION_MISSING', `An expected section type (${expectedType}) is not present.`)
    }
  }

  // --- Structure: mandatory sections must have content, no unresolved placeholders. ---
  for (const section of input.sections) {
    if (section.isMandatory && !section.hasContent) {
      blocker('MANDATORY_SECTION_EMPTY', `Mandatory section is empty.`, { sectionId: section.id })
    } else if (!section.isMandatory && !section.hasContent && section.status !== 'DRAFT') {
      warning('SECTION_EMPTY', `Section has no content yet.`, { sectionId: section.id })
    }
    if (section.hasUnresolvedPlaceholder) {
      if (section.isMandatory) blocker('UNRESOLVED_PLACEHOLDER', `Mandatory section contains an unresolved placeholder or requires-agency-input marker.`, { sectionId: section.id })
      else warning('UNRESOLVED_PLACEHOLDER', `Section contains an unresolved placeholder or requires-agency-input marker.`, { sectionId: section.id })
    }
  }

  // --- Requirements (Phase 14 §21 "Requirements"). ---
  for (const req of input.requirements) {
    if (req.coverageStatus === 'NOT_COVERED') {
      if (req.mandatory) blocker('MANDATORY_REQUIREMENT_NOT_ADDRESSED', `Mandatory requirement is not addressed by any proposal section.`, { requirementId: req.id })
      else warning('REQUIREMENT_NOT_ADDRESSED', `Requirement is not addressed by any proposal section.`, { requirementId: req.id })
    } else if (req.coverageStatus === 'PARTIAL' && req.mandatory) {
      warning('MANDATORY_REQUIREMENT_PARTIALLY_ADDRESSED', `Mandatory requirement is only partially addressed.`, { requirementId: req.id })
    }
  }

  // --- Evaluation (Phase 14 §21 "Evaluation"). ---
  for (const ev of input.evaluations) {
    if (ev.coverageStatus === 'NOT_COVERED') {
      warning('EVALUATION_CRITERION_NOT_ADDRESSED', `Evaluation criterion is not addressed by any proposal section.`, { evaluationCriterionId: ev.id })
    }
    if (ev.evidenceExpected && !ev.evidenceLinked) {
      blocker('EVALUATION_EVIDENCE_MISSING', `Evaluation criterion expects supporting evidence but none is linked.`, { evaluationCriterionId: ev.id })
    }
  }

  // --- Evidence (Phase 14 §21 "Evidence") — unsupported claims. ---
  for (const claim of input.claims) {
    if (claim.supportStatus === 'UNSUPPORTED') {
      blocker('UNSUPPORTED_CLAIM', `A substantive claim has no approved supporting evidence.`)
    } else if (claim.supportStatus === 'REQUIRES_REVIEW' || claim.supportStatus === 'PARTIALLY_SUPPORTED') {
      warning('CLAIM_REQUIRES_REVIEW', `A claim requires human review before it can be treated as fully supported.`)
    }
  }

  // --- Pricing (Phase 14 §25) — presence only, never invented/optimised. ---
  if (input.pricingRequired && !input.pricingProvided) {
    blocker('PRICING_REQUIRED', `The tender requires pricing information and none has been provided.`)
  }

  // --- Staleness (Phase 14 §38/§21 "Tender changes"). ---
  if (input.isStale) {
    blocker('PROPOSAL_STALE', input.staleReason ?? 'The proposal is stale relative to upstream tender/strategy/evidence changes and requires review.')
  }

  const hasBlocker = issues.some((i) => i.severity === 'BLOCKER')
  const hasWarning = issues.some((i) => i.severity === 'WARNING')
  let result: ProposalComplianceResult
  if (hasBlocker) result = 'BLOCKED'
  else if (hasWarning) result = 'REQUIRES_REVIEW'
  else result = 'READY_FOR_INTERNAL_REVIEW'

  return {
    result,
    issues,
    coverageScore: computeProposalCoverageScore({
      requirements: input.requirements,
      evaluations: input.evaluations,
      claims: input.claims,
      unresolvedMandatoryIssues: issues.filter((i) => i.severity === 'BLOCKER').length,
      missingInformationCount: 0,
    }),
  }
}
