import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { BID_DECISION_VIEW_ROLES, BID_DECISION_EVALUATE_ROLES, BID_DECISION_OVERRIDE_ROLES } from '@tender-os/constants'
import { bidDecisionOverrideRequestSchema } from '@tender-os/schemas'
import { requireAuth } from '../middleware/auth.js'
import { requireSupabase } from '../lib/requireSupabase.js'
import { requireRole } from '../lib/requireRole.js'
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js'
import { getBidDecision, listBidDecisionRules, listBidDecisionHistory } from '../repositories/tenderBidDecision.js'
import { createSupabaseBidDecisionStore } from '../lib/bidDecision/supabaseBidDecisionStore.js'
import { runBidDecision, BidDecisionRunAlreadyActiveError } from '../lib/bidDecision/runBidDecision.js'
import { logger } from '../lib/logger.js'

const paramsSchema = z.object({ id: z.string().uuid() })

/**
 * Phase 11 §46 API. Reads go through the caller's own RLS-scoped
 * client (agency-isolated, same as Phase 10's routes/tenderScoring.ts).
 * Evaluate/override run against the privileged service-role client for
 * writes. The engine is pure/deterministic with no external network
 * call — evaluation runs synchronously.
 *
 * ROUTE NAMING (documented in docs/DECISIONS.md, checked first per the
 * binding spec): `/api/tenders/:id/bid-decision...` was verified free
 * — routes/tenders.ts already owns `/api/tenders/:id/score` (the
 * unrelated Phase 3 legacy feature Phase 10 also had to route around),
 * but nothing in routes/ used `bid-decision` before this phase, so the
 * spec's exact §46 paths are used unchanged.
 */
export async function tenderBidDecisionRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth)

  app.get('/api/tenders/:id/bid-decision', async (request, reply) => {
    if (!requireRole(request, reply, BID_DECISION_VIEW_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const agencyId = request.user?.agencyId
    if (!agencyId) {
      reply.code(422).send({ error: { code: 'NO_AGENCY', message: 'Your account is not associated with an agency.' } })
      return
    }
    const { id: tenderId } = paramsSchema.parse(request.params)
    return getBidDecision(supabase, tenderId, agencyId)
  })

  app.get('/api/tenders/:id/bid-decision/rules', async (request, reply) => {
    if (!requireRole(request, reply, BID_DECISION_VIEW_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id: tenderId } = paramsSchema.parse(request.params)
    return listBidDecisionRules(supabase, tenderId)
  })

  app.get('/api/tenders/:id/bid-decision/history', async (request, reply) => {
    if (!requireRole(request, reply, BID_DECISION_VIEW_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id: tenderId } = paramsSchema.parse(request.params)
    return listBidDecisionHistory(supabase, tenderId)
  })

  app.post('/api/tenders/:id/bid-decision/evaluate', async (request, reply) => {
    if (!requireRole(request, reply, BID_DECISION_EVALUATE_ROLES)) return
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

    const store = createSupabaseBidDecisionStore(admin)
    try {
      const result = await runBidDecision(store, { tenderId, agencyId, triggeredBy: request.user?.id ?? null })
      reply.code(200).send(result)
    } catch (err) {
      if (err instanceof BidDecisionRunAlreadyActiveError) {
        reply.code(409).send({ error: { code: 'RUN_ALREADY_ACTIVE', message: 'A bid-decision run is already in progress for this tender.', runId: err.existingRunId } })
        return
      }
      logger.error({ err, tenderId }, 'bid decision run failed outside the handled lifecycle')
      reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Could not compute the bid decision.' } })
    }
  })

  app.post('/api/tenders/:id/bid-decision/override', async (request, reply) => {
    // Phase 11 §36 (binding constraint): ADMIN/BID_MANAGER may override;
    // RESEARCHER may view but never override.
    if (!requireRole(request, reply, BID_DECISION_OVERRIDE_ROLES)) return
    const { id: tenderId } = paramsSchema.parse(request.params)
    const agencyId = request.user?.agencyId
    if (!agencyId) {
      reply.code(422).send({ error: { code: 'NO_AGENCY', message: 'Your account is not associated with an agency.' } })
      return
    }
    const body = bidDecisionOverrideRequestSchema.safeParse(request.body)
    if (!body.success) {
      reply.code(422).send({ error: { code: 'VALIDATION_ERROR', message: 'A decision and a non-empty reason are required.', issues: body.error.issues } })
      return
    }

    const admin = getSupabaseAdmin()
    if (!admin) {
      reply.code(503).send({ error: { code: 'DATABASE_NOT_CONFIGURED', message: 'Supabase is not configured yet.' } })
      return
    }
    const supabase = requireSupabase(request, reply)
    if (!supabase) return

    const { data: currentRun, error: findErr } = await supabase.from('bid_decision_runs').select('id, agency_id').eq('tender_id', tenderId).eq('is_current', true).maybeSingle()
    if (findErr) {
      reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Could not look up the current bid decision.' } })
      return
    }
    if (!currentRun) {
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'No bid decision exists yet for this tender. Run an evaluation first.' } })
      return
    }
    // Cross-agency safety net: current-run lookup already went through the
    // caller's RLS-scoped client, so a row from another agency can never be
    // returned here — this is a defence-in-depth assertion, not the primary control.
    if (currentRun.agency_id !== agencyId) {
      reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'This bid decision does not belong to your agency.' } })
      return
    }

    const store = createSupabaseBidDecisionStore(admin)
    try {
      const updated = await store.applyOverride(currentRun.id, {
        humanDecision: body.data.decision,
        overrideReason: body.data.reason,
        overriddenBy: request.user!.id,
        overriddenAt: new Date().toISOString(),
      })
      reply.code(200).send({ run: updated })
    } catch (err) {
      logger.error({ err, tenderId }, 'bid decision override failed')
      reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Could not apply the override.' } })
    }
  })
}
