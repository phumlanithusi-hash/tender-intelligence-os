import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { clientEnv } from './env.js'

/**
 * Browser Supabase client — anon key only, per docs/SECURITY.md §4.
 * Row Level Security (docs/DATABASE.md §5) is what actually restricts
 * what this client can read/write; the anon key itself carries no
 * elevated privilege.
 *
 * Returns null when the environment isn't configured yet, so the app
 * shell can render a clear "not configured" state instead of crashing
 * (Phase 1 must be runnable before a real Supabase project exists —
 * docs/DECISIONS.md 2026-09-10).
 */
export const supabase: SupabaseClient | null = clientEnv
  ? createClient(clientEnv.VITE_SUPABASE_URL, clientEnv.VITE_SUPABASE_ANON_KEY)
  : null
