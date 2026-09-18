import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { AI_VIEW_ROLES, AI_ACTION_ROLES } from '@tender-os/constants'
import { requireAuth } from '../middleware/auth.js'
import { requireSupabase } from '../lib/requireSupabase.js'
import { requireRole } from '../lib/requireRole.js'
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js'
import { listAiRuns, getCurrentClassification } from '../repositories/tenderAi.js'
import { createSupabaseAiStore } from '../lib/ai/supabaseAiStore.js'
import { createOpenAiClient } from '../lib/ai/client.js'
import { loadAiConfig, isAiConfigured } from '../lib/ai/config.js'
import { runClassification } from '../lib/ai/execution/runAgent.js'
import { AiRunAlreadyActiveError } from '../lib/ai/errors.js'
import { logger } from '../lib/logger.js'

const paramsSchema = z.object({ id: z.string().uuid() })

/**
 * Phase 7 §29 API. Reads go through the caller's own RLS-scoped
 * client (agency-isolated — Phase 7 §20). Trigger endpoints run
 * exclusively against the privileged service-role client, since AI
 * run/classification writes have no `authenticated` write policy at
 * all (same convention as Phase 6's document pipeline routes).
 *
 * Job architecture (Phase 7 §33): no BullMQ wiring exists in this
 * codebase (re-verified for Phase 7 — same finding Phase 6 recorded).
 * `runClassification` is the exact composable, idempotent, retryable
 * stage function a future worker would call; these routes invoke it
 * fire-and-forget (never awaited inline) so the HTTP response returns
 * immediately with the QUEUED run rather than blocking on the full
 * OpenAI round trip. See docs/AI-ARCHITECTURE.md "Queue seam".
 */
export async function tenderAiRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth)

  app.get('/api/tenders/:id/ai/classification', async (request, reply) => {
    if (!requireRole(request, reply, AI_VIEW_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id: tenderId } = paramsSchema.parse(request.params)
    const classification = await getCurrentClassification(supabase, tenderId)
    if (!classification) {
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'No AI classification exists for this tender yet.' } })
      return
    }
    return classification
  })

  app.get('/api/tenders/:id/ai/runs', async (request, reply) => {
    if (!requireRole(request, reply, AI_VIEW_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id: tenderId } = paramsSchema.parse(request.params)
    return listAiRuns(supabase, tenderId)
  })

  app.post('/api/tenders/:id/ai/classify', async (request, reply) => {
    await triggerClassification(request, reply)
  })

  app.post('/api/tenders/:id/ai/reclassify', async (request, reply) => {
    await triggerClassification(request, reply)
  })

  async function triggerClassification(request: FastifyRequest, reply: FastifyReply) {
    if (!requireRole(request, reply, AI_ACTION_ROLES)) return
    const { id: tenderId } = paramsSchema.parse(request.params)
    const agencyId = request.user?.agencyId
    if (!agencyId) {
      reply.code(422).send({ error: { code: 'NO_AGENCY', message: 'Your account is not associated with an agency.' } })
      return
    }

    const config = loadAiConfig()
    if (!isAiConfigured(config)) {
      reply.code(503).send({ error: { code: 'AI_NOT_CONFIGURED', message: 'OPENAI_API_KEY is not configured.' } })
      return
    }

    const admin = getSupabaseAdmin()
    if (!admin) {
      reply.code(503).send({ error: { code: 'DATABASE_NOT_CONFIGURED', message: 'Supabase is not configured yet.' } })
      return
    }

    const store = createSupabaseAiStore(admin)
    const client = createOpenAiClient(config.apiKey!)

    try {
      const active = await store.findActiveRun(tenderId, agencyId)
      if (active) {
        reply.code(409).send({
          error: { code: 'RUN_ALREADY_ACTIVE', message: 'A classification run is already in progress for this tender.', runId: active.id },
        })
        return
      }
    } catch (err) {
      logger.error({ err, tenderId }, 'failed to check for an active AI run')
      reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Could not check run status.' } })
      return
    }

    // Fire-and-forget (Phase 7 §33) — the run's own row (QUEUED then
    // RUNNING then a terminal state) is the client's progress signal,
    // polled via GET /api/tenders/:id/ai/runs.
    runClassification(
      { store, client, config },
      { tenderId, agencyId, triggeredBy: request.user?.id ?? null },
    ).catch((err) => {
      if (err instanceof AiRunAlreadyActiveError) return
      logger.error({ err, tenderId }, 'AI classification run failed outside the handled lifecycle')
    })

    reply.code(202).send({ status: 'QUEUED', tenderId })
  }
}
