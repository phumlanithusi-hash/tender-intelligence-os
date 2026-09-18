import type { ComplianceEvaluationInput, ComplianceRequirementInput, ComplianceClaimInput, ProposalCoverageScore } from './types.js'

/**
 * Phase 14 §42 — deterministic "Proposal Coverage Score". Never called
 * win probability / chance of winning / success probability anywhere
 * in code, UI copy, or docs (binding constraint). Purely a coverage
 * measure over requirements/evaluation/evidence/issues.
 */
export function computeProposalCoverageScore(input: {
  requirements: ComplianceRequirementInput[]
  evaluations: ComplianceEvaluationInput[]
  claims: ComplianceClaimInput[]
  unresolvedMandatoryIssues: number
  missingInformationCount: number
}): ProposalCoverageScore {
  const ratio = (done: number, total: number) => (total === 0 ? 1 : Math.round((done / total) * 1000) / 1000)

  const requirementsDone = input.requirements.filter((r) => r.coverageStatus === 'COVERED').length
  const evaluationDone = input.evaluations.filter((e) => e.coverageStatus === 'COVERED').length
  const evidenceExpected = input.evaluations.filter((e) => e.evidenceExpected)
  const evidenceLinked = evidenceExpected.filter((e) => e.evidenceLinked).length
  const unsupportedClaimCount = input.claims.filter((c) => c.supportStatus === 'UNSUPPORTED').length

  return {
    requirementsCoverage: ratio(requirementsDone, input.requirements.length),
    evaluationCoverage: ratio(evaluationDone, input.evaluations.length),
    evidenceCoverage: ratio(evidenceLinked, evidenceExpected.length),
    unresolvedMandatoryIssues: input.unresolvedMandatoryIssues,
    unsupportedClaimCount,
    missingInformationCount: input.missingInformationCount,
  }
}
