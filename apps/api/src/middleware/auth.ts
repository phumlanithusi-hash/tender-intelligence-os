import type { FastifyReply, FastifyRequest } from 'fastify'
import { createClient } from '@supabase/supabase-js'
import type { AppUser } from '@tender-os/types'
import type { UserRole } from '@tender-os/constants'
import { env } from '../lib/env.js'
import { logger } from '../lib/logger.js'
import { getSupabaseForUser } from '../lib/supabaseUserClient.js'

declare module 'fastify' {
  interface FastifyRequest {
    user?: AppUser
    /**
     * The verified bearer token itself, kept alongside `user` so
     * downstream repositories can build a per-request, RLS-scoped
     * Supabase client (lib/supabaseUserClient.ts) rather than
     * defaulting to the privileged service-role client.
     */
    accessToken?: string
  }
}

/**
 * Verifies the bearer token on every protected request against
 * Supabase Auth (docs/SECURITY.md §2/§3). This never trusts a
 * client-supplied user id — the token itself is what is checked.
 *
 * Uses the anon key (not the service role key) to call
 * `auth.getUser(token)`, which asks Supabase Auth to validate the
 * token server-side. This is deliberate: verifying via the public
 * client is sufficient and keeps the privileged service-role client
 * (supabaseAdmin.ts) reserved for actual privileged data operations,
 * per the principle of least privilege.
 *
 * Role/agency enrichment reads the caller's own `users` row (Phase 2,
 * docs/DATABASE.md §3.6) via a client scoped to the caller's own
 * token (lib/supabaseUserClient.ts) — RLS's `users_select_self_or_colleagues`
 * policy permits a user to select their own row, so this is a real
 * RLS-respecting read, not a privileged lookup. A missing `users` row
 * (e.g. mid-onboarding, before Phase 2 provisioning exists) falls
 * back to the least-privileged Phase 1 default rather than failing
 * the request — an unenriched, authenticated caller is still a valid
 * caller for read-only shared-catalogue endpoints.
 */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = request.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    await reply.code(401).send({
      error: { code: 'UNAUTHENTICATED', message: 'Missing or malformed Authorization header.' },
    })
    return
  }

  const token = authHeader.slice('Bearer '.length).trim()

  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    logger.warn('Auth check attempted but Supabase is not configured.')
    await reply.code(503).send({
      error: {
        code: 'AUTH_NOT_CONFIGURED',
        message: 'Authentication is not available until Supabase is configured.',
      },
    })
    return
  }

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) {
    await reply.code(401).send({
      error: { code: 'INVALID_TOKEN', message: 'The provided session token is invalid or expired.' },
    })
    return
  }

  let role: UserRole = 'VIEWER'
  let agencyId: string | null = null
  let fullName: string | null = null

  const scopedClient = getSupabaseForUser(token)
  if (scopedClient) {
    try {
      const { data: profile, error: profileError } = await scopedClient
        .from('users')
        .select('role, agency_id, full_name')
        .eq('id', data.user.id)
        .maybeSingle()

      if (profileError) {
        logger.warn({ err: profileError }, 'Failed to enrich user profile from users table')
      } else if (profile) {
        role = profile.role as UserRole
        agencyId = profile.agency_id as string | null
        fullName = profile.full_name as string | null
      }
    } catch (err) {
      logger.warn({ err }, 'Unexpected error enriching user profile')
    }
  }

  request.user = {
    id: data.user.id,
    email: data.user.email ?? '',
    role,
    agencyId,
    fullName,
  }
  request.accessToken = token
}
