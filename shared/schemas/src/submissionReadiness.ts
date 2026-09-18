import { z } from 'zod'
import { SUBMISSION_PRICING_CURRENCY } from '@tender-os/constants'

/** Phase 15 — mirrors shared/schemas/src/proposals.ts exactly. */

export const createPricingRequestSchema = z.object({
  currency: z.enum(SUBMISSION_PRICING_CURRENCY).optional(),
})

export const createPricingItemRequestSchema = z.object({
  lineNumber: z.number().int().min(1),
  description: z.string().min(1).max(2000),
  quantity: z.number().min(0),
  unit: z.string().max(50).nullable().optional(),
  unitPrice: z.number().min(0),
  lineTotal: z.number(),
  isMandatoryScheduleItem: z.boolean().optional(),
  notes: z.string().max(2000).nullable().optional(),
})

export const updatePricingItemRequestSchema = z.object({
  description: z.string().min(1).max(2000).optional(),
  quantity: z.number().min(0).optional(),
  unit: z.string().max(50).nullable().optional(),
  unitPrice: z.number().min(0).optional(),
  lineTotal: z.number().optional(),
  isMandatoryScheduleItem: z.boolean().optional(),
  notes: z.string().max(2000).nullable().optional(),
})

export const createSubmissionApprovalRequestSchema = z.object({
  approvalReason: z.string().min(1, 'A non-empty approval reason/confirmation is required.').max(2000),
})

export const revokeSubmissionApprovalRequestSchema = z.object({
  revokedReason: z.string().min(1).max(2000),
})
