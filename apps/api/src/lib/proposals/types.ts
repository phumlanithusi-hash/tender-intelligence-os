import type { ProposalComplianceIssueSeverity, ProposalComplianceResult, ProposalSectionType } from '@tender-os/constants'

/**
 * Phase 14 — the pure-function contract, mirroring
 * lib/evidenceMatching/types.ts and lib/bidStrategy/types.ts exactly.
 * Nothing in blueprint.ts, compliance.ts, unsupportedClaims.ts,
 * coverageScore.ts or staleness.ts performs I/O of any kind (no
 * Supabase, no OpenAI, no network) — only supabaseProposalStore.ts and
 * generation.ts (an explicit I/O seam, not a pure function) touch the
 * database or the OpenAI API.
 */

// ---------------------------------------------------------------
// Blueprint / section planning (Phase 14 §7/§8/§9).
// ---------------------------------------------------------------

export interface BlueprintRequirementInput {
  id: string
  requirementType: string
  requirementText: string
  mandatory: boolean
}

export interface BlueprintEvaluationCriterionInput {
  id: string
  criterion: string
  weight: number | null
}

export interface BlueprintWinThemeInput {
  id: string
  title: string
  sourceType: string
}

export interface BlueprintDifferentiatorInput {
  id: string
  title: string
}

export interface BlueprintInput {
  requirements: BlueprintRequirementInput[]
  evaluationCriteria: BlueprintEvaluationCriterionInput[]
  winThemes: BlueprintWinThemeInput[]
  differentiators: BlueprintDifferentiatorInput[]
  hasEvidenceNeeds: boolean
  hasPricingRequirement: boolean
}

export interface BlueprintSectionPlan {
  sectionKey: string
  sectionType: ProposalSectionType
  title: string
  objective: string
  sortOrder: number
  isMandatory: boolean
  /** Requirement/criterion ids this section is expected to address — used to seed traceability links before any content exists (Phase 14 §8/§9). */
  requirementIds: string[]
  evaluationCriterionIds: string[]
}

// ---------------------------------------------------------------
// Compliance engine (Phase 14 §21/§22).
// ---------------------------------------------------------------

export interface ComplianceSectionInput {
  id: string
  sectionType: ProposalSectionType
  isMandatory: boolean
  status: string
  hasContent: boolean
  hasUnresolvedPlaceholder: boolean
}

export interface ComplianceRequirementInput {
  id: string
  mandatory: boolean
  coveredBySectionId: string | null
  coverageStatus: 'COVERED' | 'PARTIAL' | 'NOT_COVERED'
}

export interface ComplianceEvaluationInput {
  id: string
  coveredBySectionId: string | null
  coverageStatus: 'COVERED' | 'PARTIAL' | 'NOT_COVERED'
  evidenceExpected: boolean
  evidenceLinked: boolean
}

export interface ComplianceClaimInput {
  id: string
  supportStatus: string
}

export interface ComplianceInput {
  requiredSectionTypesPresent: ProposalSectionType[]
  expectedSectionTypes: ProposalSectionType[]
  sections: ComplianceSectionInput[]
  requirements: ComplianceRequirementInput[]
  evaluations: ComplianceEvaluationInput[]
  claims: ComplianceClaimInput[]
  pricingRequired: boolean
  pricingProvided: boolean
  isStale: boolean
  staleReason: string | null
}

export interface ComplianceIssue {
  code: string
  message: string
  severity: ProposalComplianceIssueSeverity
  sectionId: string | null
  requirementId: string | null
  evaluationCriterionId: string | null
}

export interface ComplianceOutcome {
  result: ProposalComplianceResult
  issues: ComplianceIssue[]
  coverageScore: ProposalCoverageScore
}

// ---------------------------------------------------------------
// Unsupported-claim engine (Phase 14 §11/§23).
// ---------------------------------------------------------------

export type EvidenceLifecycleForClaim = 'APPROVED_CURRENT' | 'APPROVED_STALE' | 'NOT_APPROVED' | 'NONE'

export interface ClaimEvaluationInput {
  claimText: string
  evidenceStatus: EvidenceLifecycleForClaim
}

export interface ClaimEvaluationResult {
  supportStatus: 'SUPPORTED' | 'PARTIALLY_SUPPORTED' | 'UNSUPPORTED' | 'REQUIRES_REVIEW'
  reason: string
}

// ---------------------------------------------------------------
// Proposal coverage score (Phase 14 §42) — never "win probability".
// ---------------------------------------------------------------

export interface ProposalCoverageScore {
  requirementsCoverage: number
  evaluationCoverage: number
  evidenceCoverage: number
  unresolvedMandatoryIssues: number
  unsupportedClaimCount: number
  missingInformationCount: number
}
