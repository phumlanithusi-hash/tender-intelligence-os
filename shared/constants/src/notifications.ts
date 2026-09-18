/**
 * Phase 19 gap-closing (spec §15) — a real, wired, user-facing
 * notification system extending the pre-existing but previously
 * unreferenced `notifications` table (Phase 2). Distinct from
 * audit_logs (system-of-record, never read/dismissed by a user).
 */

/** The 10 triggers named verbatim in spec §15. */
export const NOTIFICATION_TRIGGERS = [
  'NEW_RELEVANT_TENDER',
  'TENDER_UPDATED',
  'ADDENDUM_DETECTED',
  'BRIEFING_DEADLINE',
  'TENDER_DEADLINE',
  'DOCUMENT_PROCESSING_FAILED',
  'OUTCOME_DETECTED',
  'OUTCOME_CONFLICT',
  'OUTCOME_REQUIRES_REVIEW',
  'SUBMISSION_OUTCOME_UNKNOWN',
] as const
export type NotificationTrigger = (typeof NOTIFICATION_TRIGGERS)[number]

/** Any authenticated agency user may read/dismiss their own inbox. */
export const NOTIFICATION_VIEW_ROLES = ['ADMIN', 'BID_MANAGER', 'RESEARCHER', 'VIEWER'] as const

/** How many days ahead a deadline/briefing counts as "upcoming" for the on-demand check (spec §15). */
export const NOTIFICATION_DEADLINE_LOOKAHEAD_DAYS = 3

/** How far back the on-demand check looks for newly-created/updated facts. Idempotency comes from `dedup_key`, not from this window, so a wider window never creates duplicates — it only bounds query cost. */
export const NOTIFICATION_CHECK_LOOKBACK_DAYS = 14
