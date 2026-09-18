import { z } from 'zod'
import { aiTruthStateSchema, aiRelevanceSchema, aiTenderTypeSchema, aiGeographicScopeSchema, aiBriefingStatusSchema, aiRequirementKindSchema, aiConflictFieldSchema } from '@tender-os/schemas'

/**
 * RAW model output schema (Phase 7 §5/§19). This is what the model is
 * asked to produce — evidence refs cite the chunk IDs handed to it in
 * the context builder (Phase 7 §17), never the server's internal
 * knowledge of what evidence "should" exist. `quotedText` is what the
 * model believes the passage says; it is NEVER persisted or trusted —
 * the server resolves `chunkId` against the real stored chunk and
 * uses ONLY the canonical text (evidence/resolver.ts). This schema
 * validates SHAPE only; evidence TRUTH is validated separately.
 */
export const rawEvidenceRefSchema = z.object({
  chunkId: z.string().min(1).nullable().default(null),
  pageNumber: z.number().int().positive().nullable().default(null),
  quotedText: z.string().default(''),
})
export type RawEvidenceRef = z.infer<typeof rawEvidenceRefSchema>

const withEvidence = <T extends z.ZodRawShape>(shape: T) =>
  z.object({
    ...shape,
    truth: aiTruthStateSchema.default('UNKNOWN'),
    confidence: z.number().min(0).max(1).nullable().default(null),
    evidence: z.array(rawEvidenceRefSchema).default([]),
  })

export const rawClassificationSchema = z.object({
  relevance: withEvidence({ value: aiRelevanceSchema.default('UNKNOWN') }),
  tenderType: withEvidence({ value: aiTenderTypeSchema.default('UNKNOWN') }),
  intent: withEvidence({ text: z.string().default('') }),
  services: z
    .array(
      z.object({
        serviceId: z.string().min(1),
        confidence: z.number().min(0).max(1).nullable().default(null),
      }),
    )
    .default([]),
  deliverables: z
    .array(
      z.object({
        text: z.string().min(1),
        truth: aiTruthStateSchema.default('UNKNOWN'),
        confidence: z.number().min(0).max(1).nullable().default(null),
        evidence: z.array(rawEvidenceRefSchema).default([]),
      }),
    )
    .default([]),
  geography: withEvidence({
    scope: aiGeographicScopeSchema.default('UNKNOWN'),
    provinceId: z.string().nullable().default(null),
    municipalityId: z.string().nullable().default(null),
  }),
  contract: withEvidence({
    durationText: z.string().nullable().default(null),
    estimatedValue: z.number().nullable().default(null),
    procurementMethod: z.string().nullable().default(null),
    isFrameworkOrPanel: z.boolean().nullable().default(null),
    numberOfSuppliers: z.number().int().nullable().default(null),
    appointmentPeriod: z.string().nullable().default(null),
  }),
  briefing: withEvidence({
    status: aiBriefingStatusSchema.default('UNKNOWN'),
    date: z.string().nullable().default(null),
    time: z.string().nullable().default(null),
    location: z.string().nullable().default(null),
    url: z.string().nullable().default(null),
    isOnline: z.boolean().nullable().default(null),
    registrationRequired: z.boolean().nullable().default(null),
  }),
  apparentRequirements: z
    .array(
      z.object({
        kind: aiRequirementKindSchema.default('OTHER'),
        text: z.string().min(1),
        truth: aiTruthStateSchema.default('UNKNOWN'),
        confidence: z.number().min(0).max(1).nullable().default(null),
        evidence: z.array(rawEvidenceRefSchema).default([]),
      }),
    )
    .default([]),
  conflicts: z
    .array(
      z.object({
        field: aiConflictFieldSchema.default('OTHER'),
        documentValue: z.string().min(1),
        evidence: z.array(rawEvidenceRefSchema).default([]),
      }),
    )
    .default([]),
  summary: z.object({
    text: z.string().default(''),
    truth: aiTruthStateSchema.default('INFERENCE'),
  }),
})
export type RawClassification = z.infer<typeof rawClassificationSchema>
