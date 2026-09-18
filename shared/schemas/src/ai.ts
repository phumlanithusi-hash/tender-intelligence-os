import { z } from 'zod'
import {
  AI_RUN_STATUS,
  AI_TRUTH_STATE,
  AI_RELEVANCE,
  AI_TENDER_TYPE,
  AI_GEOGRAPHIC_SCOPE,
  AI_BRIEFING_STATUS,
  AI_REQUIREMENT_KIND,
  AI_CLAIM_TYPE,
  AI_CONFLICT_FIELD,
} from '@tender-os/constants'

export const aiRunStatusSchema = z.enum(AI_RUN_STATUS)
export const aiTruthStateSchema = z.enum(AI_TRUTH_STATE)
export const aiRelevanceSchema = z.enum(AI_RELEVANCE)
export const aiTenderTypeSchema = z.enum(AI_TENDER_TYPE)
export const aiGeographicScopeSchema = z.enum(AI_GEOGRAPHIC_SCOPE)
export const aiBriefingStatusSchema = z.enum(AI_BRIEFING_STATUS)
export const aiRequirementKindSchema = z.enum(AI_REQUIREMENT_KIND)
export const aiClaimTypeSchema = z.enum(AI_CLAIM_TYPE)
export const aiConflictFieldSchema = z.enum(AI_CONFLICT_FIELD)

const confidenceSchema = z.number().min(0).max(1).nullable()

/**
 * A resolved, server-verified evidence reference (Phase 7 §16/§17) —
 * the shape returned by the API for display, NOT what the model
 * produces. `evidenceText` is always the canonical stored text, never
 * model-echoed text.
 */
export const aiEvidenceSchema = z.object({
  id: z.string().uuid(),
  documentId: z.string().uuid(),
  documentVersionId: z.string().uuid().nullable(),
  pageId: z.string().uuid().nullable(),
  pageNumber: z.number().int().nullable(),
  sectionId: z.string().uuid().nullable(),
  chunkId: z.string().uuid().nullable(),
  evidenceText: z.string(),
})
export type AiEvidence = z.infer<typeof aiEvidenceSchema>

/** One persisted, resolved claim + its evidence (API read shape). */
export const aiClaimSchema = z.object({
  id: z.string().uuid(),
  claimType: aiClaimTypeSchema,
  claimKey: z.string(),
  claimText: z.string(),
  truth: aiTruthStateSchema,
  confidence: confidenceSchema,
  evidenceResolved: z.boolean(),
  evidence: z.array(aiEvidenceSchema).default([]),
})
export type AiClaim = z.infer<typeof aiClaimSchema>

export const aiDeliverableSchema = z.object({
  id: z.string().uuid(),
  text: z.string(),
  truth: aiTruthStateSchema,
  confidence: confidenceSchema,
  evidence: z.array(aiEvidenceSchema).default([]),
})

export const aiRequirementSchema = z.object({
  id: z.string().uuid(),
  kind: aiRequirementKindSchema,
  text: z.string(),
  truth: aiTruthStateSchema,
  confidence: confidenceSchema,
  evidence: z.array(aiEvidenceSchema).default([]),
})

export const aiServiceAssignmentSchema = z.object({
  serviceId: z.string().uuid(),
  serviceName: z.string(),
  confidence: confidenceSchema,
})

export const aiContractInfoSchema = z.object({
  durationText: z.string().nullable().default(null),
  estimatedValue: z.number().nullable().default(null),
  procurementMethod: z.string().nullable().default(null),
  isFrameworkOrPanel: z.boolean().nullable().default(null),
  numberOfSuppliers: z.number().int().nullable().default(null),
  appointmentPeriod: z.string().nullable().default(null),
})

export const aiBriefingInfoSchema = z.object({
  status: aiBriefingStatusSchema.default('UNKNOWN'),
  date: z.string().nullable().default(null),
  time: z.string().nullable().default(null),
  location: z.string().nullable().default(null),
  url: z.string().nullable().default(null),
  isOnline: z.boolean().nullable().default(null),
  registrationRequired: z.boolean().nullable().default(null),
})

export const aiConflictSchema = z.object({
  id: z.string().uuid(),
  field: aiConflictFieldSchema,
  dbValue: z.string().nullable(),
  documentValue: z.string(),
  resolved: z.boolean(),
  claimId: z.string().uuid().nullable(),
})

/** Full API read shape for a tender's current (or historical) classification. */
export const aiClassificationSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  tenderId: z.string().uuid(),
  agencyId: z.string().uuid(),
  isCurrent: z.boolean(),
  createdAt: z.string(),

  relevance: aiRelevanceSchema,
  relevanceTruth: aiTruthStateSchema,
  relevanceConfidence: confidenceSchema,

  tenderType: aiTenderTypeSchema,
  tenderTypeTruth: aiTruthStateSchema,
  tenderTypeConfidence: confidenceSchema,

  intentText: z.string().nullable(),
  intentTruth: aiTruthStateSchema,
  intentConfidence: confidenceSchema,

  services: z.array(aiServiceAssignmentSchema),
  deliverables: z.array(aiDeliverableSchema),

  geographicScope: aiGeographicScopeSchema,
  geographyProvinceId: z.string().uuid().nullable(),
  geographyMunicipalityId: z.string().uuid().nullable(),
  geographyTruth: aiTruthStateSchema,
  geographyConfidence: confidenceSchema,

  contract: aiContractInfoSchema,
  contractTruth: aiTruthStateSchema,
  contractConfidence: confidenceSchema,

  briefing: aiBriefingInfoSchema,
  briefingTruth: aiTruthStateSchema,
  briefingConfidence: confidenceSchema,

  apparentRequirements: z.array(aiRequirementSchema),
  conflicts: z.array(aiConflictSchema),

  summary: z.string().nullable(),
  summaryTruth: aiTruthStateSchema,

  claims: z.array(aiClaimSchema),
})
export type AiClassification = z.infer<typeof aiClassificationSchema>

export const aiRunSchema = z.object({
  id: z.string().uuid(),
  tenderId: z.string().uuid(),
  agencyId: z.string().uuid(),
  status: aiRunStatusSchema,
  agentName: z.string(),
  model: z.string(),
  promptVersion: z.string(),
  validationStatus: z.string().nullable(),
  validationErrors: z.array(z.string()).default([]),
  contextTruncated: z.boolean(),
  error: z.string().nullable(),
  errorStage: z.string().nullable(),
  retryCount: z.number().int(),
  inputTokensEstimate: z.number().int().nullable(),
  outputTokensEstimate: z.number().int().nullable(),
  durationMs: z.number().int().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
})
export type AiRun = z.infer<typeof aiRunSchema>
