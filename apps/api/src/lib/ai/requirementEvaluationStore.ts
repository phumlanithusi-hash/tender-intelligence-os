import type { ChunkForContext, ResolvedChunk, RunPatch, RunRecord } from './store.js'

export type { ChunkForContext, ResolvedChunk }

/**
 * Port for everything RequirementExtractionAgent's execution layer needs
 * (Phase 9 §30/§37) — a sibling to `AiStore`/`QualificationAiStore`, reusing
 * the same underlying `tender_ai_runs`/`tender_ai_claims`/`tender_ai_evidence`
 * tables (agent_name = 'RequirementExtractionAgent', agency_id = null since
 * this is a tender-scoped, not agency-scoped, extraction — see the
 * migration header note). Never touches the classification/qualification
 * stores.
 */

export interface RunPatchWithQuality extends RunPatch {
  evidenceCoverage?: number | null
  conflictCount?: number
  unknownCount?: number
  requiresReviewCount?: number
}

export interface PreviousExtractedRequirement {
  id: string
  category: string
  title: string
  version: number
}

export interface PreviousExtractedCriterion {
  id: string
  criterionType: string
  name: string
  version: number
}

export interface CreateRequirementInput {
  tenderId: string
  parentRequirementId: string | null
  category: string
  title: string
  description: string
  mandatoryStatus: string
  ruleType: string | null
  disqualificationRisk: boolean
  sourceTruth: string
  requirementStatus: string
  confidence: number | null
  version: number
  aiRunId: string
  aiClaimId: string | null
}

export interface CreateCriterionInput {
  tenderId: string
  parentCriterionId: string | null
  name: string
  description: string | null
  criterionType: string
  maximumPoints: number | null
  weight: number | null
  minimumThreshold: number | null
  scoringMethod: string | null
  scoringBands: unknown[]
  gate: boolean
  thresholdType: string | null
  formulaText: string | null
  formulaType: string | null
  formulaVariables: Record<string, unknown>
  localContentMinPercent: number | null
  presentationMandatory: boolean | null
  presentationDate: string | null
  presentationAttendees: string | null
  sourceTruth: string
  status: string
  confidence: number | null
  version: number
  aiRunId: string
  aiClaimId: string | null
}

export interface CreateGateInput {
  tenderId: string
  criterionId: string | null
  name: string
  threshold: number | null
  thresholdType: string | null
  description: string
  sourceTruth: string
  status: string
  aiRunId: string
  aiClaimId: string | null
}

export interface EvidenceLinkInput {
  documentId: string
  documentVersionId: string | null
  pageId: string | null
  sectionId: string | null
  chunkId: string | null
  pageNumber: number | null
  evidenceText: string
}

export interface RequirementEvaluationStore {
  listChunksForTender(tenderId: string, limit: number): Promise<ChunkForContext[]>
  resolveChunkForTender(tenderId: string, chunkId: string): Promise<ResolvedChunk | null>

  findActiveExtractionRun(tenderId: string): Promise<RunRecord | null>
  createExtractionRun(input: { tenderId: string; model: string; promptVersion: string; inputRefs: Record<string, unknown>; triggeredBy: string | null }): Promise<RunRecord>
  updateRun(runId: string, patch: RunPatchWithQuality): Promise<void>

  createClaim(input: { runId: string; claimType: string; claimKey: string; claimText: string; truth: string; confidence: number | null; evidenceResolved: boolean }): Promise<{ id: string }>
  createEvidence(input: { claimId: string } & EvidenceLinkInput): Promise<{ id: string }>

  listCurrentExtractedRequirements(tenderId: string): Promise<PreviousExtractedRequirement[]>
  createRequirement(input: CreateRequirementInput): Promise<{ id: string }>
  supersedeRequirement(previousId: string, newId: string, newVersion: number): Promise<void>
  linkRequirementEvidence(requirementId: string, links: EvidenceLinkInput[]): Promise<void>
  setRequirementParent(requirementId: string, parentRequirementId: string): Promise<void>

  listCurrentExtractedCriteria(tenderId: string): Promise<PreviousExtractedCriterion[]>
  createCriterion(input: CreateCriterionInput): Promise<{ id: string }>
  supersedeCriterion(previousId: string, newId: string, newVersion: number): Promise<void>
  linkCriterionEvidence(criterionId: string, links: EvidenceLinkInput[]): Promise<void>
  setCriterionParent(criterionId: string, parentCriterionId: string): Promise<void>

  createGate(input: CreateGateInput): Promise<{ id: string }>
  linkGateEvidence(gateId: string, links: EvidenceLinkInput[]): Promise<void>

  createRequirementConflict(input: { tenderId: string; category: string; description: string; evidenceA: unknown; evidenceB: unknown; requirementId: string | null }): Promise<{ id: string }>
  createEvaluationConflict(input: { tenderId: string; criterionId: string | null; description: string; evidenceA: unknown; evidenceB: unknown }): Promise<{ id: string }>
}
