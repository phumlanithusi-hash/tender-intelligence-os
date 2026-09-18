import { z } from 'zod'
import { REQUIREMENT_TYPE, QUALIFICATION_MANDATORY_STATUS, EVALUATION_CRITERION_TYPE, AI_TRUTH_STATE } from '@tender-os/constants'
import { rawEvidenceRefSchema } from '../classification/schema.js'

/**
 * RAW model output schema for RequirementExtractionAgent (Phase 9 §8/§33).
 * Same discipline as classification/qualification: every numeric field the
 * document didn't state is null, every enum defaults to UNKNOWN — the
 * agent NEVER invents a weight, threshold, or points value (Phase 9 §18),
 * and NEVER decides qualification PASS/FAIL or any bidder/agency score
 * (Phase 9 §34/§35). `evidence` chunk ids are resolved and verified
 * server-side exactly like Phase 7/8 — the model's own quoted text is
 * never trusted (evidence/resolver.ts, reused unchanged).
 */

export const requirementCategorySchema = z.enum(REQUIREMENT_TYPE)
export const requirementMandatoryStatusSchema = z.enum(QUALIFICATION_MANDATORY_STATUS)
export const evaluationCriterionTypeSchema = z.enum(EVALUATION_CRITERION_TYPE)
export const truthStateSchema = z.enum(AI_TRUTH_STATE)

export const rawExtractedRequirementSchema = z.object({
  /** Index into this array, for the server to line up nested parent/child references without relying on DB ids that don't exist yet. */
  index: z.number().int().min(0),
  /** index of the parent requirement in THIS SAME array, or null for a top-level requirement (Phase 9 §6). */
  parentIndex: z.number().int().min(0).nullable().default(null),
  title: z.string().min(1),
  description: z.string().default(''),
  category: requirementCategorySchema.default('OTHER'),
  mandatoryStatus: requirementMandatoryStatusSchema.default('UNKNOWN'),
  ruleType: z.string().nullable().default(null),
  /** Disqualification/elimination/non-responsive language detected (Phase 9 §12) — a severity flag only, never a qualification decision. */
  disqualificationLanguage: z.boolean().default(false),
  truth: truthStateSchema.default('UNKNOWN'),
  confidence: z.number().min(0).max(1).nullable().default(null),
  evidence: z.array(rawEvidenceRefSchema).default([]),
})
export type RawExtractedRequirement = z.infer<typeof rawExtractedRequirementSchema>

export const rawScoringBandSchema = z.object({
  minPercent: z.number().nullable().default(null),
  maxPercent: z.number().nullable().default(null),
  points: z.number().nullable().default(null),
  rawText: z.string().default(''),
})

export const rawEvaluationCriterionSchema = z.object({
  index: z.number().int().min(0),
  parentIndex: z.number().int().min(0).nullable().default(null),
  name: z.string().min(1),
  description: z.string().default(''),
  criterionType: evaluationCriterionTypeSchema.default('UNKNOWN'),
  /** Exact points stated in the document, or null — NEVER estimated (Phase 9 §18). */
  maximumPoints: z.number().nullable().default(null),
  /** Exact weight (e.g. a %) stated in the document, or null — kept conceptually separate from maximumPoints (Phase 9 §19). */
  weight: z.number().nullable().default(null),
  minimumThreshold: z.number().nullable().default(null),
  scoringMethod: z.enum(['POINTS', 'PERCENTAGE', 'PASS_FAIL', 'BAND', 'FORMULA', 'UNKNOWN']).default('UNKNOWN'),
  scoringBands: z.array(rawScoringBandSchema).default([]),
  gate: z.boolean().default(false),
  thresholdType: z.string().nullable().default(null),
  formulaText: z.string().nullable().default(null),
  formulaType: z.string().nullable().default(null),
  formulaVariables: z.record(z.unknown()).default({}),
  localContentMinPercent: z.number().nullable().default(null),
  presentationMandatory: z.boolean().nullable().default(null),
  presentationDate: z.string().nullable().default(null),
  presentationAttendees: z.string().nullable().default(null),
  truth: truthStateSchema.default('UNKNOWN'),
  confidence: z.number().min(0).max(1).nullable().default(null),
  evidence: z.array(rawEvidenceRefSchema).default([]),
})
export type RawEvaluationCriterion = z.infer<typeof rawEvaluationCriterionSchema>

export const rawEvaluationGateSchema = z.object({
  index: z.number().int().min(0),
  /** index into the criteria array this gate applies to, or null for a general gate naming no single criterion (Phase 9 §22). */
  criterionIndex: z.number().int().min(0).nullable().default(null),
  name: z.string().min(1),
  threshold: z.number().nullable().default(null),
  thresholdType: z.string().nullable().default(null),
  description: z.string().default(''),
  truth: truthStateSchema.default('UNKNOWN'),
  evidence: z.array(rawEvidenceRefSchema).default([]),
})
export type RawEvaluationGate = z.infer<typeof rawEvaluationGateSchema>

/**
 * Two authoritative documents disagreeing (Phase 9 §28). The model may
 * PROPOSE a conflict; the server independently verifies both evidence
 * sides resolve to real, distinct document versions before persisting it
 * as a conflict (never trusting the model's claim that two numbers
 * conflict without checking the underlying evidence itself).
 */
export const rawExtractionConflictSchema = z.object({
  type: z.enum(['REQUIREMENT', 'EVALUATION_CRITERION']).default('REQUIREMENT'),
  requirementIndex: z.number().int().min(0).nullable().default(null),
  criterionIndex: z.number().int().min(0).nullable().default(null),
  description: z.string().min(1),
  evidenceA: z.array(rawEvidenceRefSchema).default([]),
  evidenceB: z.array(rawEvidenceRefSchema).default([]),
})
export type RawExtractionConflict = z.infer<typeof rawExtractionConflictSchema>

export const rawRequirementExtractionSchema = z.object({
  requirements: z.array(rawExtractedRequirementSchema).default([]),
  evaluationFramework: z
    .object({
      criteria: z.array(rawEvaluationCriterionSchema).default([]),
      gates: z.array(rawEvaluationGateSchema).default([]),
    })
    .default({ criteria: [], gates: [] }),
  conflicts: z.array(rawExtractionConflictSchema).default([]),
})
export type RawRequirementExtraction = z.infer<typeof rawRequirementExtractionSchema>
