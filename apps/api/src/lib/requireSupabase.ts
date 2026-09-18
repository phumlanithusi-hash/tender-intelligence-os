import type { FastifyReply, FastifyRequest } from 'fastify'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseForUser } from './supabaseUserClient.js'

/**
 * Shared route guard: resolves the per-request, RLS-scoped Supabase
 * client for the caller (lib/supabaseUserClient.ts), or sends a 503
 * and returns null when Supabase isn't configured. Every route
 * handler across routes/catalogue.ts, routes/tenders.ts,
 * routes/watchlist.ts, and routes/savedFilters.ts uses this same
 * guard so "Supabase not configured" degrades identically everywhere,
 * rather than each route file inventing its own shape for the same
 * condition.
 */
export function requireSupabase(request: FastifyRequest, reply: FastifyReply): SupabaseClient | null {
  const supabase = getSupabaseForUser(request.accessToken as string)
  if (!supabase) {
    reply.code(503).send({
      error: { code: 'DATABASE_NOT_CONFIGURED', message: 'Supabase is not configured yet.' },
    })
    return null
  }
  return supabase
}
