import { z } from 'zod'
import { EVIDENCE_EMBEDDING_ENTITY_TYPE, EVIDENCE_EMBEDDING_STATUS, EVIDENCE_MATCH_STATUS } from '@tender-os/constants'

/** Phase 13 — mirrors shared/schemas/src/bidStrategy.ts exactly. */

export const evidenceEmbeddingEntityTypeSchema = z.enum(EVIDENCE_EMBEDDING_ENTITY_TYPE)
export const evidenceEmbeddingStatusSchema = z.enum(EVIDENCE_EMBEDDING_STATUS)
export const evidenceMatchStatusSchema = z.enum(EVIDENCE_MATCH_STATUS)

export const generateEvidenceMatchesRequestSchema = z.object({
  evidenceNeedId: z.string().uuid().nullable().optional(),
})

export const rejectEvidenceMatchRequestSchema = z.object({
  reason: z.string().min(1, 'A rejection reason is required.'),
})

export const approveEvidenceMatchRequestSchema = z.object({
  confirm: z.boolean().optional(),
})

export const bidEvidenceMatchSchema = z.object({
  id: z.string().uuid(),
  bidProjectId: z.string().uuid(),
  agencyId: z.string().uuid(),
  evidenceNeedId: z.string().uuid(),
  candidateEntityType: evidenceEmbeddingEntityTypeSchema,
  status: evidenceMatchStatusSchema,
  semanticScore: z.number().nullable(),
  rankFactors: z.record(z.unknown()),
  rationale: z.string().nullable(),
  verificationResult: z.record(z.unknown()),
  verificationPassed: z.boolean().nullable(),
  decidedBy: z.string().uuid().nullable(),
  decidedAt: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  isCurrent: z.boolean(),
  isStale: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type BidEvidenceMatchDto = z.infer<typeof bidEvidenceMatchSchema>

export const bidEvidenceClaimSchema = z.object({
  id: z.string().uuid(),
  bidProjectId: z.string().uuid(),
  agencyId: z.string().uuid(),
  evidenceNeedId: z.string().uuid(),
  matchId: z.string().uuid(),
  candidateEntityType: evidenceEmbeddingEntityTypeSchema,
  approvedBy: z.string().uuid(),
  approvedAt: z.string(),
  revokedAt: z.string().nullable(),
})
export type BidEvidenceClaimDto = z.infer<typeof bidEvidenceClaimSchema>
