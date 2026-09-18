import { z } from 'zod'
import { SUBMISSION_EXECUTION_METHOD, SUBMISSION_RECEIPT_TYPE } from '@tender-os/constants'

/** Phase 16 — mirrors shared/schemas/src/submissionReadiness.ts exactly. Every request body is strictly validated: unknown enum values, malformed hashes/timestamps/urls, and oversized text are all rejected. */

export const prepareSubmissionRequestSchema = z.object({
  manuallyConfirmedMethod: z.enum(SUBMISSION_EXECUTION_METHOD).nullable().optional(),
  documentEvidenceMethod: z.string().max(500).nullable().optional(),
})

export const confirmSubmissionRequestSchema = z.object({
  statement: z.string().min(20, 'A full confirmation statement is required.').max(2000),
})

export const attemptSubmissionRequestSchema = z.object({
  explicitDuplicateOverride: z.boolean().optional(),
})

export const manualCompleteSubmissionRequestSchema = z.object({
  note: z.string().max(4000).nullable().optional(),
})

export const cancelSubmissionRequestSchema = z.object({
  reason: z.string().min(1).max(2000),
})

const sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/i, 'Must be a 64-character hex SHA-256 hash.')

export const createSubmissionReceiptRequestSchema = z.object({
  attemptId: z.string().uuid().nullable().optional(),
  receiptType: z.enum(SUBMISSION_RECEIPT_TYPE),
  providerName: z.string().max(200).nullable().optional(),
  providerReference: z.string().max(500).nullable().optional(),
  receiptUrl: z.string().url().max(2000).nullable().optional(),
  receiptFile: z.string().max(2000).nullable().optional(),
  receiptHash: sha256HexSchema.nullable().optional(),
  issuedAt: z.string().datetime().nullable().optional(),
  providerIssued: z.boolean().optional(),
  notes: z.string().max(2000).nullable().optional(),
})
