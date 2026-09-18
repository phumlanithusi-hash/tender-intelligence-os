import { z } from 'zod'
import { NOTIFICATION_TRIGGERS } from '@tender-os/constants'

/** Phase 19 gap-closing — notifications row shape (extended table). */
export const notificationSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid().nullable(),
  agency_id: z.string().uuid().nullable(),
  event_type: z.string(),
  channel: z.string(),
  payload: z.record(z.unknown()).nullable(),
  entity_type: z.string().nullable(),
  entity_id: z.string().uuid().nullable(),
  related_tender_id: z.string().uuid().nullable(),
  bid_strategy_project_id: z.string().uuid().nullable(),
  dedup_key: z.string().nullable(),
  read_at: z.string().nullable(),
  dismissed_at: z.string().nullable(),
  sent_at: z.string().nullable(),
  created_at: z.string(),
})
export type NotificationRow = z.infer<typeof notificationSchema>

export const notificationEventTypeSchema = z.enum(NOTIFICATION_TRIGGERS)

export const listNotificationsQuerySchema = z.object({
  unreadOnly: z.coerce.boolean().optional(),
  includeDismissed: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})
