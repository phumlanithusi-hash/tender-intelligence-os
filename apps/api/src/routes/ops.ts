import type { FastifyInstance } from 'fastify'
import { OPS_HEALTH_VIEW_ROLES } from '@tender-os/constants'
import { requireAuth } from '../middleware/auth.js'
import { requireRole } from '../lib/requireRole.js'
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js'
import { getOpsHealthDashboard } from '../lib/ops/supabaseOpsHealthStore.js'

/**
 * Phase 19 §16 — the operational-health dashboard API. `/api/ops/health`
 * checked against every other route file first: collides with nothing.
 * Read-only; never exposes secrets/credentials (spec §16).
 */
export async function opsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth)

  app.get('/api/ops/health', async (request, reply) => {
    if (!requireRole(request, reply, OPS_HEALTH_VIEW_ROLES)) return
    const client = getSupabaseAdmin()
    if (!client) {
      reply.code(503).send({ error: { code: 'DATABASE_NOT_CONFIGURED', message: 'Supabase is not configured yet.' } })
      return
    }
    const data = await getOpsHealthDashboard(client, request.user?.agencyId ?? null)
    return { data }
  })
}
