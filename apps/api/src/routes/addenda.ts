import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { ADDENDUM_VIEW_ROLES, ADDENDUM_ACK_ROLES } from '@tender-os/constants'
import { acknowledgeAddendumRequestSchema } from '@tender-os/schemas'
import { requireAuth } from '../middleware/auth.js'
import { requireSupabase } from '../lib/requireSupabase.js'
import { requireRole } from '../lib/requireRole.js'
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js'
import { listAddendaWithAcknowledgements, acknowledgeAddendum } from '../repositories/tenderAddenda.js'
import { logger } from '../lib/logger.js'
import { recordAuditTrailEvent } from '../lib/auditTrail/writer.js'

const paramsSchema = z.object({ id: z.string().uuid() })
const addendumParamsSchema = z.object({ id: z.string().uuid(), addendumId: z.string().uuid() })

/**
 * Phase 19 §12 — addenda acknowledgement, scoped to one bid project
 * (a human, agency-specific fact — never a mutation of the shared
 * `tender_addenda` record itself). Checked against every route in
 * `routes/submissionReadiness.ts`/`routes/bidStrategy.ts` first: no
 * path here collides with `/api/bids/:id/submission-readiness` or any
 * other existing route.
 */
export async function addendaRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth)

  async function loadOwnedProject(request: FastifyRequest, reply: FastifyReply, supabase: ReturnType<typeof requireSupabase>, projectId: string) {
    if (!supabase) return null
    const agencyId = request.user?.agencyId
    if (!agencyId) {
      reply.code(422).send({ error: { code: 'NO_AGENCY', message: 'Your account is not associated with an agency.' } })
      return null
    }
    const { data: project } = await supabase.from('bid_strategy_projects').select('id, tender_id, agency_id').eq('id', projectId).maybeSingle()
    if (!project || project.agency_id !== agencyId) {
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Bid project not found.' } })
      return null
    }
    return project
  }

  app.get('/api/bids/:id/addenda', async (request, reply) => {
    if (!requireRole(request, reply, ADDENDUM_VIEW_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id } = paramsSchema.parse(request.params)
    const project = await loadOwnedProject(request, reply, supabase, id)
    if (!project) return
    const admin = getSupabaseAdmin()
    if (!admin) {
      reply.code(503).send({ error: { code: 'DATABASE_NOT_CONFIGURED', message: 'Supabase is not configured yet.' } })
      return
    }
    const addenda = await listAddendaWithAcknowledgements(admin, project.tender_id as string, id)
    return { data: addenda }
  })

  app.post('/api/bids/:id/addenda/:addendumId/acknowledge', async (request, reply) => {
    if (!requireRole(request, reply, ADDENDUM_ACK_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id, addendumId } = addendumParamsSchema.parse(request.params)
    const project = await loadOwnedProject(request, reply, supabase, id)
    if (!project) return
    const body = acknowledgeAddendumRequestSchema.parse(request.body ?? {})
    const admin = getSupabaseAdmin()
    if (!admin) {
      reply.code(503).send({ error: { code: 'DATABASE_NOT_CONFIGURED', message: 'Supabase is not configured yet.' } })
      return
    }
    // Verify the addendum actually belongs to this bid project's
    // tender before recording a fact against it (never trust a
    // frontend-supplied id blindly, spec §24 binding constraint).
    const { data: addendum } = await admin.from('tender_addenda').select('id, tender_id').eq('id', addendumId).maybeSingle()
    if (!addendum || addendum.tender_id !== project.tender_id) {
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Addendum not found for this bid project.' } })
      return
    }
    const userId = request.user?.id ?? null
    if (!userId) {
      reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'Not authenticated.' } })
      return
    }
    const record = await acknowledgeAddendum(admin, {
      agencyId: request.user!.agencyId!,
      bidProjectId: id,
      addendumId,
      acknowledgedBy: userId,
      reconciled: body.reconciled,
      note: body.note ?? null,
    })
    await admin.from('audit_logs').insert({
      agency_id: request.user!.agencyId,
      actor_id: userId,
      actor_type: 'USER',
      action: 'ADDENDUM_ACKNOWLEDGED',
      entity_type: 'bid_addendum_acknowledgements',
      entity_id: record.id,
      new_value: record,
    })
    logger.info({ bidProjectId: id, addendumId }, 'addendum acknowledged')
    // Phase 20 §4D — ADDENDUM_ACKNOWLEDGED stage, correlated by the
    // bid project.
    await recordAuditTrailEvent(admin, {
      correlationId: id,
      agencyId: request.user!.agencyId!,
      stage: 'ADDENDUM_ACKNOWLEDGED',
      entityType: 'bid_addendum_acknowledgements',
      entityId: record.id,
      actorType: 'USER',
      actorId: userId,
      summary: `Addendum ${addendumId} acknowledged for bid project ${id}.`,
    })
    return { data: record }
  })
}
