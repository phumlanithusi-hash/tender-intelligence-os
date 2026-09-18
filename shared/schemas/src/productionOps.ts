import { z } from 'zod'

/** Phase 19 — bid_addendum_acknowledgements row shape. */
export const addendumAcknowledgementSchema = z.object({
  id: z.string().uuid(),
  agency_id: z.string().uuid(),
  bid_project_id: z.string().uuid(),
  addendum_id: z.string().uuid(),
  acknowledged_by: z.string().uuid(),
  acknowledged_at: z.string(),
  reconciled: z.boolean(),
  note: z.string().nullable(),
  created_at: z.string(),
})
export type AddendumAcknowledgementRow = z.infer<typeof addendumAcknowledgementSchema>

export const acknowledgeAddendumRequestSchema = z.object({
  reconciled: z.boolean().default(false),
  note: z.string().max(2000).optional(),
})

/** Phase 19 — data_quality_violations row shape. */
export const dataQualityViolationSchema = z.object({
  id: z.string().uuid(),
  agency_id: z.string().uuid().nullable(),
  rule: z.string(),
  severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']),
  entity_type: z.string(),
  entity_id: z.string().uuid(),
  details: z.record(z.unknown()),
  detected_at: z.string(),
  status: z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED']),
  resolution: z.string().nullable(),
  resolved_by: z.string().uuid().nullable(),
  resolved_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
})
export type DataQualityViolationRow = z.infer<typeof dataQualityViolationSchema>

export const resolveDataQualityViolationRequestSchema = z.object({
  status: z.enum(['RESOLVED', 'DISMISSED']),
  resolution: z.string().min(1, 'A resolution reason is required.'),
})
