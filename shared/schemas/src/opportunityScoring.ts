import { z } from 'zod'
import {
  OPPORTUNITY_SCORE_DIMENSIONS,
  OPPORTUNITY_COMPONENT_STATUS,
  OPPORTUNITY_DECISION_SIGNAL,
  OPPORTUNITY_GATE_TYPE,
  OPPORTUNITY_GATE_STATUS,
  OPPORTUNITY_SCORING_RUN_STATUS,
  OPPORTUNITY_DEADLINE_STATUS,
} from '@tender-os/constants'

export const opportunityScoreDimensionSchema = z.enum(OPPORTUNITY_SCORE_DIMENSIONS)
export const opportunityComponentStatusSchema = z.enum(OPPORTUNITY_COMPONENT_STATUS)
export const opportunityDecisionSignalSchema = z.enum(OPPORTUNITY_DECISION_SIGNAL)
export const opportunityGateTypeSchema = z.enum(OPPORTUNITY_GATE_TYPE)
export const opportunityGateStatusSchema = z.enum(OPPORTUNITY_GATE_STATUS)
export const opportunityScoringRunStatusSchema = z.enum(OPPORTUNITY_SCORING_RUN_STATUS)
export const opportunityDeadlineStatusSchema = z.enum(OPPORTUNITY_DEADLINE_STATUS)

/** Same evidence-reference shape as Phase 8's qualification evidence (Phase 10 §45 reuses the Phase 6 evidence viewer pattern). */
export const opportunityEvidenceRefSchema = z.union([
  z.object({
    kind: z.literal('TENDER'),
    documentId: z.string().uuid(),
    documentVersionId: z.string().uuid().nullable(),
    pageId: z.string().uuid().nullable(),
    sectionId: z.string().uuid().nullable(),
    chunkId: z.string().uuid().nullable(),
    pageNumber: z.number().int().nullable(),
    evidenceText: z.string(),
  }),
  z.object({
    kind: z.literal('AGENCY'),
    agencyEvidenceId: z.string().uuid(),
    description: z.string().nullable(),
  }),
  z.object({
    kind: z.literal('RULE'),
    rule: z.string(),
    description: z.string().nullable(),
  }),
])
export type OpportunityEvidenceRefDto = z.infer<typeof opportunityEvidenceRefSchema>

export const opportunityScoreComponentSchema = z.object({
  id: z.string().uuid(),
  dimension: opportunityScoreDimensionSchema,
  status: opportunityComponentStatusSchema,
  score: z.number().min(0).max(100).nullable(),
  weight: z.number().min(0).max(1),
  explanation: z.string(),
  metadata: z.record(z.unknown()).default({}),
})
export type OpportunityScoreComponentDto = z.infer<typeof opportunityScoreComponentSchema>

export const opportunityScoreDriverSchema = z.object({
  id: z.string().uuid(),
  dimension: opportunityScoreDimensionSchema.nullable(),
  description: z.string(),
  evidence: z.array(opportunityEvidenceRefSchema).default([]),
})
export type OpportunityScoreDriverDto = z.infer<typeof opportunityScoreDriverSchema>

export const opportunityScoreRiskSchema = opportunityScoreDriverSchema
export type OpportunityScoreRiskDto = z.infer<typeof opportunityScoreRiskSchema>

export const opportunityScoreGateSchema = z.object({
  id: z.string().uuid(),
  gateType: opportunityGateTypeSchema,
  status: opportunityGateStatusSchema,
  description: z.string(),
  evidence: z.array(opportunityEvidenceRefSchema).default([]),
})
export type OpportunityScoreGateDto = z.infer<typeof opportunityScoreGateSchema>

export const opportunityScoringRunSchema = z.object({
  id: z.string().uuid(),
  tenderId: z.string().uuid(),
  agencyId: z.string().uuid(),
  status: opportunityScoringRunStatusSchema,
  scoringConfigurationVersionId: z.string().uuid(),
  overallScore: z.number().min(0).max(100).nullable(),
  dataCompleteness: z.number().min(0).max(1).nullable(),
  decisionSignal: opportunityDecisionSignalSchema.nullable(),
  deadlineStatus: opportunityDeadlineStatusSchema,
  timezoneUnknown: z.boolean(),
  isCurrent: z.boolean(),
  isStale: z.boolean(),
  inputSnapshot: z.record(z.unknown()).default({}),
  error: z.string().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
})
export type OpportunityScoringRunDto = z.infer<typeof opportunityScoringRunSchema>

/** Phase 10 §38 — the full explainable response shape for GET/POST /api/tenders/:id/score. */
export const opportunityScoreSchema = z.object({
  run: opportunityScoringRunSchema.nullable(),
  components: z.array(opportunityScoreComponentSchema).default([]),
  drivers: z.array(opportunityScoreDriverSchema).default([]),
  risks: z.array(opportunityScoreRiskSchema).default([]),
  gates: z.array(opportunityScoreGateSchema).default([]),
  /** Freeform, evidence-referenced statements of exactly what remains unresolved (Phase 10 §10/§26) — distinct from "risks", which are evidence of a problem; an unknown is merely an absence of information. */
  unknowns: z.array(z.string()).default([]),
})
export type OpportunityScoreDto = z.infer<typeof opportunityScoreSchema>

export const scoringConfigurationVersionSchema = z.object({
  id: z.string().uuid(),
  configurationId: z.string().uuid(),
  version: z.number().int(),
  dimensionWeights: z.record(z.number()),
  qualificationStatusScoreMap: z.record(z.number()),
  requirementCoverageValueMap: z.record(z.number().nullable()),
  evaluationFitValueMap: z.record(z.number()),
  evidenceStateValueMap: z.record(z.number()),
  decisionBands: z.array(z.object({ min: z.number(), max: z.number(), signal: opportunityDecisionSignalSchema })),
  dataCompletenessInsufficientThreshold: z.number().min(0).max(1),
  criticalDimensions: z.array(opportunityScoreDimensionSchema),
  isCurrent: z.boolean(),
  createdAt: z.string(),
})
export type ScoringConfigurationVersionDto = z.infer<typeof scoringConfigurationVersionSchema>

export const scoringConfigurationSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  isActive: z.boolean(),
  currentVersion: scoringConfigurationVersionSchema.nullable(),
})
export type ScoringConfigurationDto = z.infer<typeof scoringConfigurationSchema>
