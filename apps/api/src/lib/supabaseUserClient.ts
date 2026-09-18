import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { env } from './env.js'

/**
 * Per-request, RLS-scoped Supabase client: the anon key plus the
 * caller's own bearer token, so every read this client performs is
 * subject to the real Row Level Security policies for that user
 * (database/migrations/20260910200180_rls_policies.sql), not the
 * privileged service-role client (supabaseAdmin.ts).
 *
 * Deliberately NOT memoised/cached — it is scoped to one request's
 * token and must never be reused across requests or users.
 *
 * Returns null when Supabase is not configured, matching
 * supabaseAdmin.ts's degrade-gracefully behaviour (docs/DECISIONS.md
 * 2026-09-10).
 */
export function getSupabaseForUser(accessToken: string): SupabaseClient | null {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return null

  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  })
}
