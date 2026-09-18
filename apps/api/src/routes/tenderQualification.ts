import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { QUALIFICATION_VIEW_ROLES, QUALIFICATION_ACTION_ROLES } from '@tender-os/constants'
import { submitQualificationReviewSchema } from '@tender-os/schemas'
import { requireAuth } from '../middleware/auth.js'
import { requireSupabase } from '../lib/requireSupabase.js'
import { requireRole } from '../lib/requireRole.js'
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js'
import { getQualification, listQualificationRequirements, getQualificationRequirement, listQualificationActions } from '../repositories/tenderQualification.js'
import { createSupabaseQualificationStore } from '../lib/qualification/supabaseQualificationStore.js'
import { runQualification, QualificationRunAlreadyActiveError } from '../lib/qualification/runQualification.js'
import { logger } from '../lib/logger.js'

const paramsSchema = z.object({ id: z.string().uuid() })
const requirementParamsSchema = z.object({ id: z.string().uuid(), requirementId: z.string().uuid() })

/**
 * Phase 8 §33 API. Reads go through the caller's own RLS-scoped
 * client (agency-isolated). Trigger/review endpoints run against the
 * privileged service-role client, since qualification run/result
 * writes have no `authenticated` write policy at all — same
 * convention as Phase 7's routes/tenderAi.ts.
 *
 * Evaluation runs synchronously (unlike classify/reclassify, which
 * fire-and-forget an OpenAI round trip): the deterministic engine has
 * no external network call, so there is no reason to make the caller
 * poll for it.
 */
export async function tenderQualificationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth)

  app.get('/api/tenders/:id/qualification', async (request, reply) => {
    if (!requireRole(request, reply, QUALIFICATION_VIEW_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id: tenderId } = paramsSchema.parse(request.params)
    return getQualification(supabase, tenderId)
  })

  app.get('/api/tenders/:id/qualification/requirements', async (request, reply) => {
    if (!requireRole(request, reply, QUALIFICATION_VIEW_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id: tenderId } = paramsSchema.parse(request.params)
    return listQualificationRequirements(supabase, tenderId)
  })

  app.get('/api/tenders/:id/qualification/requirements/:requirementId', async (request, reply) => {
    if (!requireRole(request, reply, QUALIFICATION_VIEW_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id: tenderId, requirementId } = requirementParamsSchema.parse(request.params)
    const requirement = await getQualificationRequirement(supabase, tenderId, requirementId)
    if (!requirement) {
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Requirement not found for this tender.' } })
      return
    }
    return requirement
  })

  app.get('/api/tenders/:id/qualification/actions', async (request, reply) => {
    if (!requireRole(request, reply, QUALIFICATION_VIEW_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id: tenderId } = paramsSchema.parse(request.params)
    return listQualificationActions(supabase, tenderId)
  })

  app.post('/api/tenders/:id/qualification/evaluate', async (request, reply) => {
    if (!requireRole(request, reply, QUALIFICATION_ACTION_ROLES)) return
    const { id: tenderId } = paramsSchema.parse(request.params)
    const agencyId = request.user?.agencyId
    if (!agencyId) {
      reply.code(422).send({ error: { code: 'NO_AGENCY', message: 'Your account is not associated with an agency.' } })
      return
    }

    const admin = getSupabaseAdmin()
    if (!admin) {
      reply.code(503).send({ error: { code: 'DATABASE_NOT_CONFIGURED', message: 'Supabase is not configured yet.' } })
      return
    }

    const store = createSupabaseQualificationStore(admin)
    try {
      const result = await runQualification(store, { tenderId, agencyId, triggeredBy: request.user?.id ?? null })
      reply.code(200).send(result)
    } catch (err) {
      if (err instanceof QualificationRunAlreadyActiveError) {
        reply.code(409).send({ error: { code: 'RUN_ALREADY_ACTIVE', message: 'A qualification evaluation run is already in progress for this tender.', runId: err.existingRunId } })
        return
      }
      logger.error({ err, tenderId }, 'qualification evaluation run failed outside the handled lifecycle')
      reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Could not evaluate qualification.' } })
    }
  })

  app.post('/api/tenders/:id/qualification/review', async (request, reply) => {
    if (!requireRole(request, reply, QUALIFICATION_ACTION_ROLES)) return
    const { id: tenderId } = paramsSchema.parse(request.params)
    const agencyId = request.user?.agencyId
    const userId = request.user?.id
    if (!agencyId || !userId) {
      reply.code(422).send({ error: { code: 'NO_AGENCY', message: 'Your account is not associated with an agency.' } })
      return
    }
    const body = submitQualificationReviewSchema.parse(request.body)

    const admin = getSupabaseAdmin()
    if (!admin) {
      reply.code(503).send({ error: { code: 'DATABASE_NOT_CONFIGURED', message: 'Supabase is not configured yet.' } })
      return
    }

    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { data: run, error: runErr } = await supabase.from('tender_qualification_runs').select('id').eq('tender_id', tenderId).eq('is_current', true).maybeSingle()
    if (runErr) {
      logger.error({ err: runErr, tenderId }, 'failed to look up current qualification run for review')
      reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Could not record review.' } })
      return
    }
    if (!run) {
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'No qualification run exists for this tender yet — evaluate first.' } })
      return
    }

    const store = createSupabaseQualificationStore(admin)
    const review = await store.createReview({
      runId: run.id,
      requirementId: body.requirementId ?? null,
      tenderId,
      agencyId,
      reviewerId: userId,
      decision: body.decision,
      note: body.note ?? null,
    })
    reply.code(201).send(review)
  })
}
