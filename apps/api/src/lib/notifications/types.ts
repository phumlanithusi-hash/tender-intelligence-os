import type { NotificationRow } from '@tender-os/schemas'
import type { NotificationTrigger } from '@tender-os/constants'

/**
 * Phase 19 gap-closing (spec §15) — a real, user-facing notification
 * system. Port interface following the same pure-function +
 * store-seam pattern as every other engine in this codebase
 * (lib/dataQuality/store.ts, lib/ops/health.ts, etc.) so build/dedup
 * logic is unit-testable without a live Supabase project.
 */
export interface CreateNotificationInput {
  /** null = agency-wide notification (every member of the agency sees it, e.g. a shared tender fact); set = one specific user. */
  userId: string | null
  /** null only for a purely global fact — in practice always set for anything this system creates, since every trigger originates from agency-relevant activity. */
  agencyId: string | null
  eventType: NotificationTrigger
  entityType: string
  entityId: string
  relatedTenderId?: string | null
  bidStrategyProjectId?: string | null
  payload?: Record<string, unknown>
  /** Unique-when-present key preventing a duplicate row for the same detected fact (spec §15 "deduplicated"). Always pass one — see build.ts's `buildDedupKey`. */
  dedupKey: string
}

export interface NotificationStore {
  /** Idempotent: if a row with this dedup_key already exists, returns it unchanged rather than creating a duplicate. */
  create(input: CreateNotificationInput): Promise<NotificationRow>
  list(filter: { agencyId: string; userId: string; unreadOnly?: boolean; includeDismissed?: boolean; limit: number }): Promise<NotificationRow[]>
  countUnread(agencyId: string, userId: string): Promise<number>
  markRead(id: string, agencyId: string, userId: string): Promise<NotificationRow | null>
  dismiss(id: string, agencyId: string, userId: string): Promise<NotificationRow | null>
}
