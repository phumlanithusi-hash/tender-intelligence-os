import type {
  QualificationCategory,
  QualificationCheckStatus,
  QualificationMandatoryStatus,
  QualificationRuleType,
  QualificationEvaluatedBy,
  QualificationActionPriority,
} from '@tender-os/constants'

/**
 * Phase 8 §10 — the deterministic rule engine's pure-function
 * contract. Given identical (requirement + agency evidence) inputs,
 * `evaluateRequirement` MUST return the same `RuleResult` every time:
 * no hidden I/O, no clock reads beyond what is passed in as `now`, no
 * randomness. This is what makes the engine fully unit-testable
 * without a database (same discipline as Phase 4's
 * `computeSourceHealth`).
 */

/** One evidence reference the compliance check result can cite (Phase 8 §30/§34). Tender-side evidence always carries at least a documentId; page_id is intentionally never populated here (Phase 7 §42 carried-forward technical debt) but the field exists so it can be populated later without a schema change. */
export interface TenderEvidenceRef {
  kind: 'TENDER'
  documentId: string
  documentVersionId: string | null
  sectionId: string | null
  chunkId: string | null
  pageId: string | null
  pageNumber: number | null
  evidenceText: string
}

/** Agency-side evidence reference — always resolves to a real row in the already-generic `agency_evidence` table (Phase 2). */
export interface AgencyEvidenceRef {
  kind: 'AGENCY'
  agencyEvidenceId: string
  description: string | null
}

export type EvidenceRef = TenderEvidenceRef | AgencyEvidenceRef

/**
 * A structured qualification requirement, as consumed by the rule
 * engine — the pure-data projection of a `tender_requirements` row
 * (Phase 8 §7). `ruleConfig` is deliberately untyped JSON at this
 * layer; each rule module in rules/*.ts validates and narrows the
 * slice of config shape it actually understands.
 */
export interface QualificationRequirement {
  id: string
  tenderId: string
  category: QualificationCategory
  description: string
  mandatoryStatus: QualificationMandatoryStatus
  ruleType: QualificationRuleType | null
  ruleConfig: Record<string, unknown>
  /** VERIFIED / PROVISIONAL / REQUIRES_REVIEW — a PROVISIONAL requirement is still evaluated, but the result must never be presented as a verified qualification rule (Phase 8 §6). */
  requirementStatus: 'VERIFIED' | 'PROVISIONAL' | 'REQUIRES_REVIEW'
  tenderEvidence: TenderEvidenceRef[]
}

/**
 * The slice of agency evidence the engine may consult. Every field is
 * `| null`/empty-array when unverified/absent — the engine must NEVER
 * invent a value here; absence means UNKNOWN, not FAIL (Phase 8 §43).
 */
export interface AgencyEvidenceSnapshot {
  agencyId: string
  csdStatus: 'REGISTERED' | 'NOT_REGISTERED' | 'UNKNOWN'
  csdEvidence: AgencyEvidenceRef[]
  taxCompliant: boolean | null
  taxExpiry: string | null // ISO date
  taxEvidence: AgencyEvidenceRef[]
  bbbeeLevel: number | null // 1-8, or null if unverified
  bbbeeEvidence: AgencyEvidenceRef[]
  registrationStatus: 'VERIFIED' | 'UNVERIFIED' | 'UNKNOWN'
  registrationEvidence: AgencyEvidenceRef[]
  yearsInBusiness: number | null
  yearsInBusinessEvidence: AgencyEvidenceRef[]
  annualTurnover: number | null
  turnoverEvidence: AgencyEvidenceRef[]
  certificates: AgencyCertificateSnapshot[]
  documents: AgencyDocumentSnapshot[]
  experienceRecords: AgencyExperienceRecord[]
  referenceRecords: AgencyReferenceRecord[]
  keyPersonnelCount: number | null
  keyPersonnelEvidence: AgencyEvidenceRef[]
  briefingAttendance: 'ATTENDED' | 'NOT_ATTENDED' | 'UNKNOWN'
  briefingAttendanceEvidence: AgencyEvidenceRef[]
  /** Free-text office/service-area description — geography is deliberately NOT resolved to a province/municipality FK (Phase 7/Phase 8 §21/§42 carried-forward limitation). */
  geographyText: string | null
  geographyEvidence: AgencyEvidenceRef[]
}

export interface AgencyCertificateSnapshot {
  id: string
  certificateType: string
  expiryDate: string | null // ISO date
  lifecycleStatus: 'VALID' | 'EXPIRED' | 'MISSING' | 'PENDING_VERIFICATION' | 'REJECTED' | 'UNKNOWN'
  evidence: AgencyEvidenceRef[]
}

export interface AgencyDocumentSnapshot {
  id: string
  documentType: string
  expiryDate: string | null
  lifecycleStatus: 'VALID' | 'EXPIRED' | 'MISSING' | 'PENDING_VERIFICATION' | 'REJECTED' | 'UNKNOWN'
  evidence: AgencyEvidenceRef[]
}

export interface AgencyExperienceRecord {
  id: string
  serviceId: string | null
  industry: string | null
  clientType: string | null
  projectType: string | null
  projectValue: number | null
  year: number | null
  geographyText: string | null
  evidenceStatus: 'VERIFIED' | 'INFERRED' | 'UNVERIFIED' | 'UNKNOWN'
  evidence: AgencyEvidenceRef[]
}

export interface AgencyReferenceRecord {
  id: string
  isCurrent: boolean
  periodStart: string | null
  periodEnd: string | null
  clientType: string | null
  evidenceStatus: 'VERIFIED' | 'INFERRED' | 'UNVERIFIED' | 'UNKNOWN'
  evidence: AgencyEvidenceRef[]
}

export interface QualificationAction {
  description: string
  priority: QualificationActionPriority
  dueDate: string | null // ISO timestamp, never invented
}

/**
 * The compliance check record for one requirement (Phase 8 §30),
 * minus the persistence-only fields (id/runId/evaluatedAt) added by
 * the caller.
 */
export interface RuleResult {
  status: QualificationCheckStatus
  mandatory: boolean
  explanation: string
  agencyEvidence: AgencyEvidenceRef[]
  tenderEvidence: TenderEvidenceRef[]
  evaluatedBy: QualificationEvaluatedBy
  confidence: number | null
  requiresHumanReview: boolean
  actions: QualificationAction[]
}

export interface EvaluationContext {
  /** UTC ISO 8601 timestamp used for every date/expiry comparison — never `new Date()` read inside a rule (Phase 8 §12). */
  now: string
  tenderClosingDate: string | null
  briefingDate: string | null
  briefingRequired: boolean | null
}
