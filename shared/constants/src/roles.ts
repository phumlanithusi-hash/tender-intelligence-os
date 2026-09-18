/**
 * User roles (spec §39). Permissions per role are declared explicitly
 * in apps/api RBAC middleware — this list is the enum source of truth
 * shared between frontend (UI gating) and backend (enforcement).
 */
export const USER_ROLES = [
  'ADMIN',
  'BID_MANAGER',
  'RESEARCHER',
  'WRITER',
  'REVIEWER',
  'VIEWER',
] as const

export type UserRole = (typeof USER_ROLES)[number]

/**
 * Roles permitted to take high-risk, human-review-gated actions
 * (AI-ARCHITECTURE.md §7): final NO-BID, final bid readiness, pricing,
 * final submission. Enforced in API middleware, not just the UI.
 */
export const HIGH_RISK_ACTION_ROLES: UserRole[] = ['ADMIN', 'BID_MANAGER']
