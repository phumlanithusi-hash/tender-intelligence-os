import type { BidEffortLevel } from '@tender-os/constants'

/**
 * Phase 12 §27/§29 — the pure-function contract, mirroring
 * lib/bidDecision/types.ts and lib/scoring/types.ts exactly. Nothing
 * in this file or in buildStrategy.ts/readiness.ts/projectGate.ts
 * performs I/O of any kind (no Supabase, no OpenAI, no network) —
 * only supabaseBidStrategyStore.ts touches the database.
 */

export interface EvaluationCriterionInput {
  id: string
  criterion: string
  description: string | null
  weight: number | null
  /** Count of rows in the Phase 10 `tender_evaluation_criterion_agency_evidence` link table — the ONLY signal this phase may use for "is this criterion evidence-backed"; never inferred by matching. */
  evidenceLinkCount: number
}

export interface RequirementInput {
  id: string
  requirementType: string
  requirementText: string
  mandatory: boolean
  /** Phase 8's qualification_status for this requirement — consumed, never recalculated (Phase 12 §14). */
  qualificationStatus: 'PASS' | 'FAIL' | 'UNKNOWN' | 'ACTION_REQUIRED' | 'REQUIRES_REVIEW' | string
  qualificationEvidenceId: string | null
}

export interface BidStrategyBuildInput {
  tenderId: string
  agencyId: string
  bidProjectId: string
  version: number
  /** Agency-configurable, never hard-coded at the call site (Phase 12 §27 worked example: "if weight >= configured threshold"). */
  evaluationWeightThreshold: number
  tenderClosingDate: string | null
  briefingRequired: boolean
  qualificationOverallStatus: string | null
  requirements: RequirementInput[]
  evaluationCriteria: EvaluationCriterionInput[]
  opportunityScore: number | null
  bidDecisionFinal: 'BID' | 'REVIEW' | 'NO_BID' | null
  bidEffort: BidEffortLevel
}

export interface PriorityDraft {
  priorityClass: 'CLIENT' | 'TENDER'
  title: string
  description: string | null
  sourceType: 'EVALUATION_CRITERION' | 'TENDER_REQUIREMENT' | 'HUMAN_DEFINED'
  sourceId: string | null
  weight: number | null
  rank: number | null
}

export interface WinThemeDraft {
  title: string
  description: string | null
  sourceType: 'TENDER_REQUIREMENT' | 'EVALUATION_CRITERION' | 'AGENCY_CAPABILITY' | 'AGENCY_DIFFERENTIATOR' | 'HUMAN_DEFINED'
  sourceId: string | null
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  evidenceStatus: 'UNKNOWN' | 'EVIDENCE_REQUIRED' | 'SUPPORTED' | 'PARTIALLY_SUPPORTED' | 'UNVERIFIED'
}

export interface EvaluationStrategyDraft {
  evaluationCriterionId: string
  strategy: string | null
  responseObjective: string | null
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  evidenceRequired: boolean
  evidenceStatus: 'UNKNOWN' | 'EVIDENCE_REQUIRED' | 'SUPPORTED' | 'PARTIALLY_SUPPORTED' | 'UNVERIFIED'
}

export interface RequirementPlanDraft {
  tenderRequirementId: string
  responseType: 'COMPLY' | 'EXPLAIN' | 'PROVIDE_DOCUMENT' | 'PROVIDE_EVIDENCE' | 'CLARIFY' | 'REQUIRES_HUMAN_REVIEW' | 'NOT_APPLICABLE'
  responseStatus: 'NOT_STARTED' | 'IN_PROGRESS' | 'READY' | 'BLOCKED' | 'REVIEW'
  evidenceRequired: boolean
  evidenceStatus: 'UNKNOWN' | 'EVIDENCE_REQUIRED' | 'SUPPORTED' | 'PARTIALLY_SUPPORTED' | 'UNVERIFIED'
  notes: string | null
}

export interface EvidenceNeedDraft {
  sourceType: 'TENDER_REQUIREMENT' | 'EVALUATION_CRITERION'
  sourceId: string
  requirementId: string | null
  evaluationCriterionId: string | null
  description: string
  minimumCount: number
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
}

export interface RiskDraft {
  title: string
  description: string | null
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  sourceType: 'TENDER_REQUIREMENT' | 'EVALUATION_CRITERION' | 'QUALIFICATION_RESULT' | 'BID_DECISION' | 'CLOSING_DATE' | 'BRIEFING'
  sourceId: string | null
  mitigation: string | null
}

export interface AssumptionDraft {
  statement: string
  sourceType: 'OPPORTUNITY_SCORE' | 'BID_DECISION' | 'HUMAN_DEFINED'
  sourceId: string | null
}

export interface WorkstreamDraft {
  category: 'STRATEGY' | 'CONTENT' | 'DESIGN' | 'CASE_STUDIES' | 'COMMERCIAL' | 'COMPLIANCE' | 'LEGAL' | 'PRODUCTION' | 'APPROVAL' | 'SUBMISSION'
  name: string
  description: string | null
}

export interface BidStrategyDraft {
  objective: string
  strategySummary: string
  responseStrategySummary: string
  evidenceStrategySummary: string
  productionStrategySummary: string
  riskStrategySummary: string
  clientPriorities: PriorityDraft[]
  tenderPriorities: PriorityDraft[]
  winThemes: WinThemeDraft[]
  differentiators: [] // Phase 12 never invents differentiators — always HUMAN_DEFINED and authored by a person via the API (§9/§42). The pure generator produces none automatically.
  evaluationStrategies: EvaluationStrategyDraft[]
  requirementPlans: RequirementPlanDraft[]
  evidenceNeeds: EvidenceNeedDraft[]
  risks: RiskDraft[]
  assumptions: AssumptionDraft[]
  workstreams: WorkstreamDraft[]
}
