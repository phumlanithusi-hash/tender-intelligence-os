import { z } from 'zod'
import { REQUIREMENT_TYPE, QUALIFICATION_MANDATORY_STATUS, QUALIFICATION_REQUIREMENT_STATUS, AI_TRUTH_STATE, EVALUATION_CRITERION_TYPE, QUALIFICATION_CONFLICT_STATUS, AI_RUN_STATUS } from '@tender-os/constants'

/**
 * Phase 9 — Requirement & Evaluation Extraction DTOs. Mirrors
 * shared/schemas/src/qualification.ts exactly in shape/style. These
 * validate what the API sends to the browser, not the raw AI output
 * (that Zod schema lives server-side only, in
 * apps/api/src/lib/ai/agents/extraction/schema.ts, since it must never
 * be trusted or exposed as-is).
 */

export const requirementTaxonomyCategorySchema = z.enum(REQUIREMENT_TYPE)
export const requirementMandatoryStatusSchema = z.enum(QUALIFICATION_MANDATORY_STATUS)
export const requirementStatusSchema = z.enum(QUALIFICATION_REQUIREMENT_STATUS)
export const requirementSourceTruthSchema = z.enum(AI_TRUTH_STATE)
export const evaluationCriterionTypeSchema = z.enum(EVALUATION_CRITERION_TYPE)
export const evaluationConflictStatusSchema = z.enum(QUALIFICATION_CONFLICT_STATUS)
export const extractionRunStatusSchema = z.enum(AI_RUN_STATUS)

export const evidenceRefDtoSchema = z.object({
  id: z.string().uuid(),
  documentId: z.string().uuid(),
  documentVersionId: z.string().uuid().nullable(),
  pageId: z.string().uuid().nullable(),
  sectionId: z.string().uuid().nullable(),
  chunkId: z.string().uuid().nullable(),
  pageNumber: z.number().int().nullable(),
  evidenceText: z.string(),
})
export type EvidenceRefDto = z.infer<typeof evidenceRefDtoSchema>

export const extractedRequirementSchema = z.object({
  id: z.string().uuid(),
  tenderId: z.string().uuid(),
  parentRequirementId: z.string().uuid().nullable(),
  category: requirementTaxonomyCategorySchema,
  title: z.string(),
  description: z.string(),
  mandatoryStatus: requirementMandatoryStatusSchema,
  requirementStatus: requirementStatusSchema,
  ruleType: z.string().nullable(),
  sourceTruth: requirementSourceTruthSchema,
  disqualificationRisk: z.boolean(),
  confidence: z.number().min(0).max(1).nullable(),
  version: z.number().int(),
  supersededBy: z.string().uuid().nullable(),
  evidence: z.array(evidenceRefDtoSchema).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type ExtractedRequirementDto = z.infer<typeof extractedRequirementSchema>

export const scoringBandSchema = z.object({
  minPercent: z.number().nullable().default(null),
  maxPercent: z.number().nullable().default(null),
  points: z.number().nullable().default(null),
  rawText: z.string().default(''),
})
export type ScoringBandDto = z.infer<typeof scoringBandSchema>

export const evaluationCriterionSchema = z.object({
  id: z.string().uuid(),
  tenderId: z.string().uuid(),
  parentCriterionId: z.string().uuid().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  criterionType: evaluationCriterionTypeSchema,
  maximumPoints: z.number().nullable(),
  weight: z.number().nullable(),
  minimumThreshold: z.number().nullable(),
  scoringMethod: z.string().nullable(),
  scoringBands: z.array(scoringBandSchema).default([]),
  gate: z.boolean(),
  thresholdType: z.string().nullable(),
  formulaText: z.string().nullable(),
  formulaType: z.string().nullable(),
  formulaVariables: z.record(z.unknown()).default({}),
  localContentMinPercent: z.number().nullable(),
  presentationMandatory: z.boolean().nullable(),
  presentationDate: z.string().nullable(),
  presentationAttendees: z.string().nullable(),
  sourceTruth: requirementSourceTruthSchema,
  status: requirementStatusSchema,
  version: z.number().int(),
  supersededBy: z.string().uuid().nullable(),
  evidence: z.array(evidenceRefDtoSchema).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type EvaluationCriterionDto = z.infer<typeof evaluationCriterionSchema>

export const evaluationGateSchema = z.object({
  id: z.string().uuid(),
  tenderId: z.string().uuid(),
  criterionId: z.string().uuid().nullable(),
  name: z.string(),
  threshold: z.number().nullable(),
  thresholdType: z.string().nullable(),
  description: z.string().nullable(),
  sourceTruth: requirementSourceTruthSchema,
  status: requirementStatusSchema,
  evidence: z.array(evidenceRefDtoSchema).default([]),
  createdAt: z.string(),
})
export type EvaluationGateDto = z.infer<typeof evaluationGateSchema>

export const requirementConflictSchema = z.object({
  id: z.string().uuid(),
  tenderId: z.string().uuid(),
  category: z.string(),
  description: z.string(),
  evidenceA: z.record(z.unknown()),
  evidenceB: z.record(z.unknown()),
  status: evaluationConflictStatusSchema,
  createdAt: z.string(),
})
export type RequirementConflictDto = z.infer<typeof requirementConflictSchema>

export const evaluationConflictSchema = z.object({
  id: z.string().uuid(),
  tenderId: z.string().uuid(),
  criterionId: z.string().uuid().nullable(),
  description: z.string(),
  evidenceA: z.record(z.unknown()),
  evidenceB: z.record(z.unknown()),
  status: evaluationConflictStatusSchema,
  createdAt: z.string(),
})
export type EvaluationConflictDto = z.infer<typeof evaluationConflictSchema>

export const evaluationSchema = z.object({
  criteria: z.array(evaluationCriterionSchema).default([]),
  gates: z.array(evaluationGateSchema).default([]),
  conflicts: z.array(evaluationConflictSchema).default([]),
})
export type EvaluationDto = z.infer<typeof evaluationSchema>

export const extractionRunSchema = z.object({
  id: z.string().uuid(),
  tenderId: z.string().uuid(),
  status: extractionRunStatusSchema,
  agentName: z.string(),
  model: z.string(),
  promptVersion: z.string(),
  contextTruncated: z.boolean(),
  evidenceCoverage: z.number().min(0).max(1).nullable(),
  conflictCount: z.number().int(),
  unknownCount: z.number().int(),
  requiresReviewCount: z.number().int(),
  validationStatus: z.string().nullable(),
  validationErrors: z.array(z.string()).default([]),
  error: z.string().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
})
export type ExtractionRunDto = z.infer<typeof extractionRunSchema>

export const submitRequirementReviewSchema = z.object({
  decision: z.string().min(1).max(200),
  note: z.string().max(4000).nullable().optional(),
})

export const submitEvaluationCriterionReviewSchema = z.object({
  decision: z.string().min(1).max(200),
  note: z.string().max(4000).nullable().optional(),
})
