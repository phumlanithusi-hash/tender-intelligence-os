import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { env } from './env.js'
import { logger } from './logger.js'

/**
 * Privileged, server-only Supabase client using the service role key.
 * This module must never be imported from apps/web — the workspace
 * boundary (separate package, separate build) is what makes that
 * structurally impossible rather than just a convention
 * (docs/SECURITY.md §4, docs/ARCHITECTURE.md §7).
 *
 * Returns null when Supabase is not yet configured (Phase 1 can run
 * without a live project — docs/DECISIONS.md 2026-09-10) so callers
 * degrade gracefully instead of crashing the process at import time.
 */
let cachedClient: SupabaseClient | null | undefined

export function getSupabaseAdmin(): SupabaseClient | null {
  if (cachedClient !== undefined) return cachedClient

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    logger.warn(
      'Supabase is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing) — ' +
        'privileged database operations are unavailable until a project is connected.',
    )
    cachedClient = null
    return cachedClient
  }

  cachedClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return cachedClient
}

/** Test-only helper to reset the memoised client between test cases. */
export function __resetSupabaseAdminForTests(): void {
  cachedClient = undefined
}
