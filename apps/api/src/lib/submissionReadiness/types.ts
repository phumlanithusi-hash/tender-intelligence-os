import type {
  SubmissionComplianceCategory,
  SubmissionDeadlineState,
  SubmissionDeadlineWarning,
  SubmissionDocumentStatus,
  SubmissionFileNameResult,
  SubmissionItemSeverity,
  SubmissionMethod,
  SubmissionReadinessStatus,
  SubmissionRequirementStatus,
  SubmissionSignatureStatus,
} from '@tender-os/constants'

/**
 * Phase 15 §8 — the pure-function contract, mirroring
 * lib/proposals/types.ts / lib/bidStrategy/readiness.ts exactly.
 * calculateSubmissionReadiness performs no I/O of any kind (no
 * Supabase, no OpenAI, no network, no Date.now() — `nowIso` is always
 * passed in) and is fully deterministic: the same input always
 * produces the same output.
 */

export interface SubmissionRequirementInput {
  id: string
  mandatory: boolean
  status: SubmissionRequirementStatus
  description: string
}

export interface SubmissionEvaluationCriterionInput {
  id: string
  weight: number | null
  mandatoryCoverage: boolean
  covered: boolean
}

export interface SubmissionBriefingInput {
  id: string
  mandatory: boolean
  /** null = attendance unknown (never inferred — Phase 15 §25 binding constraint). */
  attended: boolean | null
  attendanceRecorded: boolean
}

export interface SubmissionAddendumInput {
  id: string
  addendumNumber: number
  isMaterial: boolean
  acknowledgementRequired: boolean
  acknowledged: boolean
  /** Whether the current proposal/evidence/pricing has been reconciled against this addendum's impact. */
  reconciled: boolean
}

export interface SubmissionProposalInput {
  exists: boolean
  versionId: string | null
  matchesTender: boolean
  matchesBidProject: boolean
  isCurrentVersion: boolean
  isStale: boolean
  staleReason: string | null
  complianceResult: 'BLOCKED' | 'REQUIRES_REVIEW' | 'READY_FOR_INTERNAL_REVIEW' | null
  missingRequiredSections: string[]
}

/** Phase 15 §16 — only APPROVED_CURRENT evidence satisfies a final requirement; every other lifecycle state is rejected or flagged. */
export type SubmissionEvidenceLifecycle = 'APPROVED_CURRENT' | 'APPROVED_STALE' | 'REJECTED' | 'CANDIDATE_OR_UNVERIFIED' | 'SUPERSEDED'

export interface SubmissionEvidenceInput {
  id: string
  mandatory: boolean
  lifecycle: SubmissionEvidenceLifecycle
}

export interface SubmissionPricingLineCheck {
  id: string
  description: string
  quantityValid: boolean
  unitPriceValid: boolean
  totalMatchesArithmetic: boolean
  currencyPresent: boolean
}

export interface SubmissionPricingInput {
  required: boolean
  provided: boolean
  currencyPresent: boolean
  lines: SubmissionPricingLineCheck[]
  mandatoryScheduleRequired: boolean
  mandatorySchedulePresent: boolean
}

export interface SubmissionDocumentInput {
  id: string
  name: string
  required: boolean
  status: SubmissionDocumentStatus
}

export interface SubmissionFormInput {
  id: string
  name: string
  required: boolean
  /** null = unknown/unverifiable, never assumed true. */
  completed: boolean | null
  signed: boolean | null
  attached: boolean
}

export interface SubmissionCertificateInput {
  id: string
  name: string
  required: boolean
  status: 'VALID' | 'EXPIRED' | 'UNKNOWN' | 'MISSING'
}

export interface SubmissionSignatureInput {
  id: string
  name: string
  status: SubmissionSignatureStatus
}

export interface SubmissionFileInput {
  id: string
  fileName: string
  required: boolean
  exists: boolean
  /** null = tender specifies no explicit constraint for this dimension. */
  formatValid: boolean | null
  sizeValid: boolean | null
  nameResult: SubmissionFileNameResult
}

export interface SubmissionMethodInput {
  method: SubmissionMethod | null
  instructionsKnown: boolean
}

export interface SubmissionQualificationInput {
  finalBidDecision: 'BID' | 'REVIEW' | 'NO_BID' | null
}

export interface SubmissionReadinessInput {
  nowIso: string
  tenderClosingDate: string | null // ISO date (YYYY-MM-DD)
  tenderClosingTime: string | null // HH:MM[:SS]
  qualification: SubmissionQualificationInput
  requirements: SubmissionRequirementInput[]
  evaluationCriteria: SubmissionEvaluationCriterionInput[]
  briefings: SubmissionBriefingInput[]
  addenda: SubmissionAddendumInput[]
  proposal: SubmissionProposalInput
  evidence: SubmissionEvidenceInput[]
  pricing: SubmissionPricingInput
  documents: SubmissionDocumentInput[]
  forms: SubmissionFormInput[]
  certificates: SubmissionCertificateInput[]
  signatures: SubmissionSignatureInput[]
  files: SubmissionFileInput[]
  submissionMethod: SubmissionMethodInput
}

export interface SubmissionReadinessItem {
  category: SubmissionComplianceCategory
  severity: SubmissionItemSeverity
  code: string
  message: string
  sourceType: string | null
  sourceId: string | null
}

export interface SubmissionCategorySummary {
  blockers: number
  warnings: number
  info: number
}

export interface SubmissionDeadlineResult {
  state: SubmissionDeadlineState
  warning: SubmissionDeadlineWarning
}

export interface SubmissionReadinessResult {
  status: SubmissionReadinessStatus
  items: SubmissionReadinessItem[]
  categorySummary: Record<SubmissionComplianceCategory, SubmissionCategorySummary>
  deadline: SubmissionDeadlineResult
  blockerCount: number
  warningCount: number
}
