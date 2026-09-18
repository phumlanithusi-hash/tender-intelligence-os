import type {
  OpportunityScoreDimension,
  OpportunityComponentStatus,
  OpportunityDecisionSignal,
  OpportunityGateType,
  OpportunityGateStatus,
  OpportunityDeadlineStatus,
  RequirementCoverageStatus,
  EvaluationFitStrength,
  EvidenceStrengthState,
  QualificationOverallStatus,
} from '@tender-os/constants'

/**
 * Phase 10 §10/§45 evidence reference — a strict superset of Phase 8's
 * `EvidenceRef` with one addition (`RULE`) for a driver/risk/gate whose
 * "evidence" is a deterministic rule/policy rather than a document or
 * agency record (e.g. "no qualification run exists yet"). Never a
 * freeform narrative string on its own — always structured.
 */
export type ScoringEvidenceRef =
  | { kind: 'TENDER'; documentId: string; documentVersionId: string | null; sectionId: string | null; chunkId: string | null; pageId: string | null; pageNumber: number | null; evidenceText: string }
  | { kind: 'AGENCY'; agencyEvidenceId: string; description: string | null }
  | { kind: 'RULE'; rule: string; description: string | null }

export interface ScoringConfiguration {
  id: string
  version: number
  dimensionWeights: Record<OpportunityScoreDimension, number>
  qualificationStatusScoreMap: Record<QualificationOverallStatus, number>
  requirementCoverageValueMap: Record<RequirementCoverageStatus, number | null>
  evaluationFitValueMap: Record<Exclude<EvaluationFitStrength, 'UNKNOWN'>, number>
  evidenceStateValueMap: Record<EvidenceStrengthState, number>
  decisionBands: Array<{ min: number; max: number; signal: OpportunityDecisionSignal }>
  dataCompletenessInsufficientThreshold: number
  criticalDimensions: OpportunityScoreDimension[]
}

export interface ScoredComponent {
  dimension: OpportunityScoreDimension
  status: OpportunityComponentStatus
  score: number | null // 0-100, null unless status === 'KNOWN'
  weight: number // this dimension's configured weight (0-1)
  explanation: string
  drivers: Array<{ description: string; evidence: ScoringEvidenceRef[] }>
  risks: Array<{ description: string; evidence: ScoringEvidenceRef[] }>
  unknowns: string[]
  metadata: Record<string, unknown>
}

export interface ScoredGate {
  gateType: OpportunityGateType
  status: OpportunityGateStatus
  description: string
  evidence: ScoringEvidenceRef[]
}

// ---------------------------------------------------------------------
// Inputs — the pure-function projection of Phase 8/9/agency-evidence
// data the engine consumes. Assembled by supabaseScoringStore.ts;
// evaluateOpportunity(...) itself never touches a database.
// ---------------------------------------------------------------------

export interface QualificationInput {
  runId: string | null
  overallStatus: QualificationOverallStatus | null // null only when no run has ever completed
  runUpdatedAt: string | null
  results: Array<{
    requirementId: string
    status: 'PASS' | 'FAIL' | 'UNKNOWN' | 'REQUIRES_ACTION'
    mandatory: boolean
    explanation: string
    tenderEvidence: ScoringEvidenceRef[]
    agencyEvidence: ScoringEvidenceRef[]
  }>
}

export interface RequirementInput {
  id: string
  mandatoryStatus: 'MANDATORY' | 'CONDITIONALLY_MANDATORY' | 'PREFERENTIAL' | 'INFORMATIONAL' | 'UNKNOWN'
  requirementType: string
  description: string
  version: number
  updatedAt: string
}

export interface EvidenceLinkInput {
  criterionId: string
  evidenceType: string
  evidenceState: EvidenceStrengthState
  evidenceRef: ScoringEvidenceRef
}

export interface EvaluationCriterionInput {
  id: string
  criterion: string
  criterionType: string
  weight: number | null // as extracted from the tender document — never invented
  gate: boolean
  minimumScore: number | null
  version: number
  updatedAt: string
  linkedEvidence: EvidenceLinkInput[]
}

export interface EvaluationGateInput {
  id: string
  name: string
  threshold: number | null
  status: 'VERIFIED' | 'PROVISIONAL' | 'REQUIRES_REVIEW' | 'CONFLICT'
}

export interface AgencyEvidenceStateInput {
  id: string
  kind: 'CASE_STUDY' | 'REFERENCE' | 'CERTIFICATE' | 'TEAM_MEMBER' | 'DOCUMENT' | 'FINANCIAL_RECORD'
  state: EvidenceStrengthState
  evidenceRef: ScoringEvidenceRef
  updatedAt: string
}

export interface CommercialInput {
  estimatedValue: number | null
  contractDuration: string | null
  agencyMinProjectValue: number | null
}

export interface StrategicInput {
  strategicProfileKnown: boolean // agencies.strategic_profile_status === 'VERIFIED'
  targetSectors: string[]
  preferredOrgTypes: string[]
  strategicCapabilities: string[]
  tenderOrgType: string | null // tenders.entity_type
  tenderCategory: string | null
}

export interface ServiceAlignmentInput {
  requiredServiceIds: string[] // from tender_services, mandatory/all extracted services
  agencyServiceIds: string[] // from agency_services (active)
  serviceLabels: Record<string, string> // id -> display label, for explanations
}

export interface GeographyInput {
  tenderScope: Array<{ scopeType: string; provinceId: string | null; municipalityId: string | null }>
  agencyScope: Array<{ scopeType: string; provinceId: string | null; municipalityId: string | null }>
  agencyGeographyKnown: boolean
}

export interface BriefingInput {
  required: boolean | null
  attendance: 'ATTENDED' | 'NOT_ATTENDED' | 'UNKNOWN'
  evidence: ScoringEvidenceRef[]
}

export interface DeadlineInput {
  closingDate: string | null // ISO date (YYYY-MM-DD), timezone never known — see docs/SCORING-ENGINE.md
  closingTime: string | null // HH:MM:SS, same caveat
}

export interface ScoringInput {
  tenderId: string
  agencyId: string
  now: string // UTC ISO 8601 — injected for reproducibility, never `new Date()` read inside the engine
  qualification: QualificationInput
  requirements: RequirementInput[]
  evaluationCriteria: EvaluationCriterionInput[]
  evaluationGates: EvaluationGateInput[]
  agencyEvidence: AgencyEvidenceStateInput[]
  commercial: CommercialInput
  strategic: StrategicInput
  serviceAlignment: ServiceAlignmentInput
  geography: GeographyInput
  briefing: BriefingInput
  deadline: DeadlineInput
}

export interface OpportunityScoreResult {
  overallScore: number | null
  dataCompleteness: number
  decisionSignal: OpportunityDecisionSignal
  deadlineStatus: OpportunityDeadlineStatus
  timezoneUnknown: boolean
  components: ScoredComponent[]
  gates: ScoredGate[]
  drivers: Array<{ dimension: OpportunityScoreDimension | null; description: string; evidence: ScoringEvidenceRef[] }>
  risks: Array<{ dimension: OpportunityScoreDimension | null; description: string; evidence: ScoringEvidenceRef[] }>
  unknowns: string[]
}
