import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { OPPORTUNITY_SCORE_VIEW_ROLES, OPPORTUNITY_SCORE_ACTION_ROLES, OPPORTUNITY_SCORE_CONFIG_VIEW_ROLES } from '@tender-os/constants'
import { requireAuth } from '../middleware/auth.js'
import { requireSupabase } from '../lib/requireSupabase.js'
import { requireRole } from '../lib/requireRole.js'
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js'
import { getOpportunityScore, listScoreComponents, listScoreDrivers, listScoreRisks, listScoreGates, listScoringRuns, listScoringConfigurations } from '../repositories/tenderScoring.js'
import { createSupabaseScoringStore } from '../lib/scoring/supabaseScoringStore.js'
import { runScoring, ScoringRunAlreadyActiveError } from '../lib/scoring/runScoring.js'
import { logger } from '../lib/logger.js'

const paramsSchema = z.object({ id: z.string().uuid() })

/**
 * Phase 10 §37/§38 API. Reads go through the caller's own RLS-scoped
 * client (agency-isolated, same as Phase 8's routes/tenderQualification.ts).
 * The evaluate endpoint runs against the privileged service-role client
 * for writes. The engine is pure/deterministic and has no external
 * network call (like Phase 8, unlike Phase 7/9's AI runs) — evaluation
 * runs synchronously and the caller gets the result immediately rather
 * than polling.
 *
 * PATH DEVIATION FROM THE SPEC (documented in docs/DECISIONS.md): §37
 * lists these routes under `/api/tenders/:id/score...`, but that exact
 * path is already owned by the pre-existing, unrelated Phase 3 legacy
 * scoring feature (routes/tenders.ts `GET /api/tenders/:id/score`,
 * backed by `tender_scores_risks` and BID/NO_BID vocabulary this phase
 * must never touch or reuse — see the migration header). Reusing that
 * path would either collide at the Fastify router level or silently
 * merge two conceptually separate scoring systems, both explicitly
 * forbidden. Every Phase 10 route therefore lives under
 * `/api/tenders/:id/opportunity-score...` instead — same shape, same
 * roles, same semantics as §37/§38, different base segment.
 */
export async function tenderScoringRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth)

  app.get('/api/tenders/:id/opportunity-score', async (request, reply) => {
    if (!requireRole(request, reply, OPPORTUNITY_SCORE_VIEW_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const agencyId = request.user?.agencyId
    if (!agencyId) {
      reply.code(422).send({ error: { code: 'NO_AGENCY', message: 'Your account is not associated with an agency.' } })
      return
    }
    const { id: tenderId } = paramsSchema.parse(request.params)
    return getOpportunityScore(supabase, tenderId, agencyId)
  })

  app.get('/api/tenders/:id/opportunity-score/components', async (request, reply) => {
    if (!requireRole(request, reply, OPPORTUNITY_SCORE_VIEW_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id: tenderId } = paramsSchema.parse(request.params)
    return listScoreComponents(supabase, tenderId)
  })

  app.get('/api/tenders/:id/opportunity-score/drivers', async (request, reply) => {
    if (!requireRole(request, reply, OPPORTUNITY_SCORE_VIEW_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id: tenderId } = paramsSchema.parse(request.params)
    return listScoreDrivers(supabase, tenderId)
  })

  app.get('/api/tenders/:id/opportunity-score/risks', async (request, reply) => {
    if (!requireRole(request, reply, OPPORTUNITY_SCORE_VIEW_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id: tenderId } = paramsSchema.parse(request.params)
    return listScoreRisks(supabase, tenderId)
  })

  app.get('/api/tenders/:id/opportunity-score/gates', async (request, reply) => {
    if (!requireRole(request, reply, OPPORTUNITY_SCORE_VIEW_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id: tenderId } = paramsSchema.parse(request.params)
    return listScoreGates(supabase, tenderId)
  })

  app.get('/api/tenders/:id/opportunity-score/runs', async (request, reply) => {
    if (!requireRole(request, reply, OPPORTUNITY_SCORE_VIEW_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id: tenderId } = paramsSchema.parse(request.params)
    return listScoringRuns(supabase, tenderId)
  })

  app.get('/api/scoring/configurations', async (request, reply) => {
    if (!requireRole(request, reply, OPPORTUNITY_SCORE_CONFIG_VIEW_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    return listScoringConfigurations(supabase)
  })

  app.post('/api/tenders/:id/opportunity-score', async (request, reply) => {
    if (!requireRole(request, reply, OPPORTUNITY_SCORE_ACTION_ROLES)) return
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

    const store = createSupabaseScoringStore(admin)
    try {
      const result = await runScoring(store, { tenderId, agencyId, triggeredBy: request.user?.id ?? null })
      reply.code(200).send(result)
    } catch (err) {
      if (err instanceof ScoringRunAlreadyActiveError) {
        reply.code(409).send({ error: { code: 'RUN_ALREADY_ACTIVE', message: 'A scoring run is already in progress for this tender.', runId: err.existingRunId } })
        return
      }
      logger.error({ err, tenderId }, 'scoring run failed outside the handled lifecycle')
      reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Could not compute opportunity score.' } })
    }
  })
}
