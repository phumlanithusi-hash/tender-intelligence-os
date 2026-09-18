import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { DATA_QUALITY_VIEW_ROLES, DATA_QUALITY_MANAGE_ROLES } from '@tender-os/constants'
import { resolveDataQualityViolationRequestSchema } from '@tender-os/schemas'
import { requireAuth } from '../middleware/auth.js'
import { requireRole } from '../lib/requireRole.js'
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js'
import { createSupabaseDataQualityStore } from '../lib/dataQuality/supabaseDataQualityStore.js'
import { logger } from '../lib/logger.js'

const listQuerySchema = z.object({ status: z.string().optional(), severity: z.string().optional() })
const violationParamsSchema = z.object({ id: z.string().uuid() })

/**
 * Phase 19 §17/§18 — the data-quality dashboard API. Checked against
 * every other route file first: `/api/data-quality/*` collides with
 * nothing already registered.
 *
 * Every response is filtered server-side to what the caller's own
 * agency is entitled to see (spec §24 binding constraint — never
 * trust a frontend-supplied agency id/scope): shared/catalogue-level
 * violations (agency_id is null) are visible to everyone; agency-
 * scoped ones only to that agency, even though the underlying store
 * runs on the privileged service-role client (mirroring the same
 * app-layer filtering discipline used by
 * routes/submissionReadiness.ts's loadOwnedProject).
 */
export async function dataQualityRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth)

  function admin(reply: FastifyReply) {
    const client = getSupabaseAdmin()
    if (!client) {
      reply.code(503).send({ error: { code: 'DATABASE_NOT_CONFIGURED', message: 'Supabase is not configured yet.' } })
      return null
    }
    return client
  }

  app.post('/api/data-quality/scan', async (request, reply) => {
    if (!requireRole(request, reply, DATA_QUALITY_MANAGE_ROLES)) return
    const client = admin(reply)
    if (!client) return
    const store = createSupabaseDataQualityStore(client)
    const created = await store.runScan(request.user?.id ?? null)
    logger.info({ newViolations: created.length }, 'data quality scan run')
    return { data: created }
  })

  app.get('/api/data-quality/violations', async (request, reply) => {
    if (!requireRole(request, reply, DATA_QUALITY_VIEW_ROLES)) return
    const client = admin(reply)
    if (!client) return
    const { status, severity } = listQuerySchema.parse(request.query)
    const store = createSupabaseDataQualityStore(client)
    const agencyId = request.user?.agencyId ?? null
    const all = await store.listViolations({ status, severity })
    // Server-side agency filter (never client-supplied): shared rows
    // (agency_id null) plus only this caller's own agency-scoped rows.
    const visible = all.filter((v) => v.agency_id === null || v.agency_id === agencyId)
    return { data: visible }
  })

  app.post('/api/data-quality/violations/:id/resolve', async (request, reply) => {
    if (!requireRole(request, reply, DATA_QUALITY_MANAGE_ROLES)) return
    const client = admin(reply)
    if (!client) return
    const { id } = violationParamsSchema.parse(request.params)
    const body = resolveDataQualityViolationRequestSchema.parse(request.body)
    const store = createSupabaseDataQualityStore(client)
    const agencyId = request.user?.agencyId ?? null
    const existing = (await store.listViolations({})).find((v) => v.id === id)
    if (!existing || (existing.agency_id !== null && existing.agency_id !== agencyId)) {
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Violation not found.' } })
      return
    }
    const resolved = await store.resolveViolation(id, { status: body.status, resolution: body.resolution, resolvedBy: request.user!.id })
    return { data: resolved }
  })

  app.get('/api/data-quality/completeness', async (request, reply) => {
    if (!requireRole(request, reply, DATA_QUALITY_VIEW_ROLES)) return
    const client = admin(reply)
    if (!client) return
    const agencyId = request.user?.agencyId
    if (!agencyId) {
      reply.code(422).send({ error: { code: 'NO_AGENCY', message: 'Your account is not associated with an agency.' } })
      return
    }
    const store = createSupabaseDataQualityStore(client)
    const data = await store.getCompletenessDashboard(agencyId)
    return { data }
  })
}
