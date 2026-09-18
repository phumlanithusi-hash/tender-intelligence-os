import { z } from 'zod'
import {
  PROPOSAL_STATUS,
  PROPOSAL_SECTION_TYPE,
  PROPOSAL_SECTION_STATUS,
  PROPOSAL_BLOCK_TYPE,
  CONTENT_ORIGIN,
  CLAIM_SUPPORT_STATUS,
  PROPOSAL_REVIEW_ACTION,
  PROPOSAL_DOCUMENT_FORMAT,
} from '@tender-os/constants'

/** Phase 14 — mirrors shared/schemas/src/evidenceMatching.ts exactly. */

export const proposalStatusSchema = z.enum(PROPOSAL_STATUS)
export const proposalSectionTypeSchema = z.enum(PROPOSAL_SECTION_TYPE)
export const proposalSectionStatusSchema = z.enum(PROPOSAL_SECTION_STATUS)
export const proposalBlockTypeSchema = z.enum(PROPOSAL_BLOCK_TYPE)
export const contentOriginSchema = z.enum(CONTENT_ORIGIN)
export const claimSupportStatusSchema = z.enum(CLAIM_SUPPORT_STATUS)

// -------------------------------------------------------------------
// Requests (Phase 14 §36).
// -------------------------------------------------------------------

export const createProposalSectionRequestSchema = z.object({
  sectionType: proposalSectionTypeSchema,
  title: z.string().min(1).max(300),
  objective: z.string().max(2000).nullable().optional(),
  sortOrder: z.number().int().optional(),
  isMandatory: z.boolean().optional(),
})

export const generateProposalSectionRequestSchema = z.object({
  userInstructions: z.string().max(4000).nullable().optional(),
})

export const patchProposalSectionRequestSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  objective: z.string().max(2000).nullable().optional(),
  blocks: z
    .array(
      z.object({
        blockType: proposalBlockTypeSchema,
        content: z.record(z.unknown()),
        sortOrder: z.number().int().optional(),
      }),
    )
    .optional(),
})

export const reviewProposalSectionRequestSchema = z.object({
  note: z.string().max(2000).optional(),
})

export const rejectProposalSectionRequestSchema = z.object({
  reason: z.string().min(1, 'A rejection reason is required.'),
})

// -------------------------------------------------------------------
// Generation contract (Phase 14 §14) — the ONLY shape a proposal
// section generation may return. Zod validation is mandatory; invalid
// output is rejected/retried, never persisted as approved content.
// -------------------------------------------------------------------

export const proposalContentBlockSchema = z.object({
  blockType: proposalBlockTypeSchema,
  heading: z.string().nullable().optional(),
  text: z.string().nullable().optional(),
  items: z.array(z.string()).nullable().optional(),
  table: z
    .object({
      headers: z.array(z.string()),
      rows: z.array(z.array(z.string())),
    })
    .nullable()
    .optional(),
  // A REQUIREMENT_RESPONSE/EVIDENCE_REFERENCE/CASE_STUDY block cites
  // the exact source ids it draws on — never a free-floating claim.
  requirementId: z.string().uuid().nullable().optional(),
  evaluationCriterionId: z.string().uuid().nullable().optional(),
  evidenceClaimId: z.string().uuid().nullable().optional(),
})
export type ProposalContentBlock = z.infer<typeof proposalContentBlockSchema>

export const proposalGenerationClaimSchema = z.object({
  claimText: z.string().min(1),
  /** The AI may only ever cite an evidence claim id it was given in context; the server independently re-verifies this id is a currently-APPROVED bid_evidence_claims row before ever persisting SUPPORTED (Phase 14 §10/§23). */
  evidenceClaimId: z.string().uuid().nullable(),
})

export const proposalGenerationMissingInfoSchema = z.object({
  description: z.string().min(1),
  sourceRequirementId: z.string().uuid().nullable(),
  severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']),
})

/** ProposalGenerationResult (Phase 14 §14), the full structured-output contract. */
export const proposalGenerationResultSchema = z.object({
  sectionTitle: z.string().min(1),
  sectionPurpose: z.string().min(1),
  contentBlocks: z.array(proposalContentBlockSchema).max(40),
  claims: z.array(proposalGenerationClaimSchema).max(40),
  requirementReferences: z.array(z.string().uuid()).max(100),
  evaluationReferences: z.array(z.string().uuid()).max(100),
  evidenceReferences: z.array(z.string().uuid()).max(100),
  warnings: z.array(z.string()).max(40),
  missingInformation: z.array(proposalGenerationMissingInfoSchema).max(40),
  unsupportedClaims: z.array(z.string()).max(40),
  confidence: z.number().min(0).max(1),
})
export type ProposalGenerationResult = z.infer<typeof proposalGenerationResultSchema>

// -------------------------------------------------------------------
// Response DTOs.
// -------------------------------------------------------------------

export const bidProposalSchema = z.object({
  id: z.string().uuid(),
  bidProjectId: z.string().uuid(),
  tenderId: z.string().uuid(),
  agencyId: z.string().uuid(),
  status: proposalStatusSchema,
  currentVersion: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type BidProposalDto = z.infer<typeof bidProposalSchema>

export const bidProposalVersionSchema = z.object({
  id: z.string().uuid(),
  proposalId: z.string().uuid(),
  agencyId: z.string().uuid(),
  version: z.number().int(),
  status: proposalStatusSchema,
  isCurrent: z.boolean(),
  isStale: z.boolean(),
  staleReason: z.string().nullable(),
  createdAt: z.string(),
})
export type BidProposalVersionDto = z.infer<typeof bidProposalVersionSchema>

export const reviewProposalSectionResponseSchema = z.object({
  id: z.string().uuid(),
  sectionId: z.string().uuid(),
  reviewerId: z.string().uuid(),
  action: z.enum(PROPOSAL_REVIEW_ACTION),
  reason: z.string().nullable(),
  createdAt: z.string(),
})

export const assembleProposalDocumentRequestSchema = z.object({
  format: z.enum(PROPOSAL_DOCUMENT_FORMAT),
})
