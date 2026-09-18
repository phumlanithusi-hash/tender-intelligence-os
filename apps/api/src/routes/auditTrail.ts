import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { AUDIT_TRAIL_VIEW_ROLES } from '@tender-os/constants'
import { requireAuth } from '../middleware/auth.js'
import { requireRole } from '../lib/requireRole.js'
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js'
import { listAuditTrailByCorrelation, listRecentAuditTrailEvents } from '../repositories/auditTrail.js'

const correlationParams = z.object({ correlationId: z.string().uuid() })
const listQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) })

/**
 * Phase 20 §4D — the unified Audit Log Viewer API
 * (`/settings/audit-logs`). Route paths checked against every other
 * route file first: `/api/audit-trail/*` collides with nothing
 * already registered (routes/notifications.ts owns `/api/notifications`,
 * routes/dataQuality.ts owns `/api/data-quality/*`; neither overlaps).
 *
 * ADMIN-only (spec §4D binding constraint: full chain-of-custody
 * lineage is at least as sensitive as `audit_logs` itself, which is
 * likewise ADMIN-only — docs/SECURITY.md §9).
 */
export async function auditTrailRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth)

  app.get('/api/audit-trail', async (request, reply) => {
    if (!requireRole(request, reply, AUDIT_TRAIL_VIEW_ROLES)) return
    const client = getSupabaseAdmin()
    if (!client) {
      reply.code(503).send({ error: { code: 'DATABASE_NOT_CONFIGURED', message: 'Supabase is not configured yet.' } })
      return
    }
    const { limit } = listQuery.parse(request.query)
    const data = await listRecentAuditTrailEvents(client, limit)
    return { data }
  })

  // Traceability requirement (spec §4D): clicking any bid submission
  // (or tender) shows its complete immutable lineage, correlated by
  // this one id.
  app.get('/api/audit-trail/:correlationId', async (request, reply) => {
    if (!requireRole(request, reply, AUDIT_TRAIL_VIEW_ROLES)) return
    const client = getSupabaseAdmin()
    if (!client) {
      reply.code(503).send({ error: { code: 'DATABASE_NOT_CONFIGURED', message: 'Supabase is not configured yet.' } })
      return
    }
    const { correlationId } = correlationParams.parse(request.params)
    const data = await listAuditTrailByCorrelation(client, correlationId)
    return { data }
  })
}
