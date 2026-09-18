import { z } from 'zod'
import {
  DATA_CONFIDENCE,
  OUTPUT_TYPE,
  QUALIFICATION_STATUS,
  COMPLIANCE_STATE,
  SOURCE_HEALTH,
  BID_DECISION,
  SEVERITY,
} from '@tender-os/constants'

/**
 * Shared enum schemas for the provenance vocabulary
 * (AI-ARCHITECTURE.md §2). Every agent output schema and every
 * database-backed API response reuses these rather than redefining
 * the same string unions, so the vocabulary cannot drift between
 * an agent's schema and the API's persistence schema.
 */
export const dataConfidenceSchema = z.enum(DATA_CONFIDENCE)
export const outputTypeSchema = z.enum(OUTPUT_TYPE)
export const qualificationStatusSchema = z.enum(QUALIFICATION_STATUS)
export const complianceStateSchema = z.enum(COMPLIANCE_STATE)
export const sourceHealthSchema = z.enum(SOURCE_HEALTH)
export const bidDecisionSchema = z.enum(BID_DECISION)
export const severitySchema = z.enum(SEVERITY)

/**
 * A single tagged statement — every prose element an AI agent emits
 * must be wrapped in this shape (AI-ARCHITECTURE.md §2/§3).
 */
export const taggedStatementSchema = z.object({
  text: z.string().min(1),
  type: outputTypeSchema,
  evidence: z
    .array(
      z.object({
        documentId: z.string().uuid(),
        page: z.number().int().positive().optional(),
        section: z.string().optional(),
        quote: z.string().min(1),
      }),
    )
    .default([]),
})

export type TaggedStatement = z.infer<typeof taggedStatementSchema>
