import type { UserRole } from '@tender-os/constants'

/**
 * Application-level user profile. `role` and `agencyId` are enriched
 * from the `users` table (docs/DATABASE.md §3.6) by
 * apps/api/src/middleware/auth.ts once the caller's token is
 * verified; both fall back to their Phase 1 defaults (`'VIEWER'`,
 * `null`) if the caller has no `users` row yet (e.g. mid-onboarding).
 */
export interface AppUser {
  id: string
  email: string
  role: UserRole
  agencyId: string | null
  fullName: string | null
}

export interface AuthSession {
  user: AppUser
  accessToken: string
  expiresAt: number
}
