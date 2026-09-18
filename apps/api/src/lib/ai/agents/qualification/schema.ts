import { z } from 'zod'
import { aiTruthStateSchema } from '@tender-os/schemas'
import { QUALIFICATION_CATEGORY, QUALIFICATION_RULE_TYPE, QUALIFICATION_MANDATORY_STATUS } from '@tender-os/constants'
import { rawEvidenceRefSchema } from '../classification/schema.js'

export const qualificationCategorySchema = z.enum(QUALIFICATION_CATEGORY)
export const qualificationRuleTypeSchema = z.enum(QUALIFICATION_RULE_TYPE)
export const qualificationMandatoryStatusSchema = z.enum(QUALIFICATION_MANDATORY_STATUS)

/**
 * RAW model output schema for QualificationInterpretationAgent (Phase
 * 8 §26). The agent NEVER decides PASS/FAIL/UNKNOWN/REQUIRES_ACTION —
 * this shape has no such field at all. It interprets ambiguous tender
 * wording into category/ruleType/mandatoryStatus plus an evidence-gated
 * explanation of the ambiguity, exactly mirroring the classification
 * agent's evidence-per-claim shape (chunkId/pageNumber/quotedText —
 * quotedText is never trusted, resolved server-side like Phase 7).
 */
export const rawQualificationInterpretationItemSchema = z.object({
  /** Echoes which candidate input text this interpretation is for, so the server can line results back up 1:1 without relying on array order. */
  candidateIndex: z.number().int().min(0),
  category: qualificationCategorySchema.default('UNKNOWN'),
  ruleType: qualificationRuleTypeSchema.nullable().default(null),
  mandatoryStatus: qualificationMandatoryStatusSchema.default('UNKNOWN'),
  /** Suggested deterministic rule parameters (e.g. { minTurnover: 10000000 }) — a SUGGESTION only; the server never executes this blindly, and REQUIRES_REVIEW is preserved for the human to confirm the actual rule config used. */
  suggestedRuleConfig: z.record(z.unknown()).default({}),
  truth: aiTruthStateSchema.default('UNKNOWN'),
  confidence: z.number().min(0).max(1).nullable().default(null),
  /** The agent's own interpretation text — may explain WHY something is ambiguous (Phase 8 §26 example). Never a qualification decision. */
  interpretation: z.string().default(''),
  requiresReview: z.boolean().default(false),
  evidence: z.array(rawEvidenceRefSchema).default([]),
})
export type RawQualificationInterpretationItem = z.infer<typeof rawQualificationInterpretationItemSchema>

export const rawQualificationInterpretationSchema = z.object({
  interpretations: z.array(rawQualificationInterpretationItemSchema).default([]),
})
export type RawQualificationInterpretation = z.infer<typeof rawQualificationInterpretationSchema>
