import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { REQUIREMENT_EVALUATION_VIEW_ROLES, REQUIREMENT_EVALUATION_ACTION_ROLES } from '@tender-os/constants'
import { submitRequirementReviewSchema, submitEvaluationCriterionReviewSchema } from '@tender-os/schemas'
import { requireAuth } from '../middleware/auth.js'
import { requireSupabase } from '../lib/requireSupabase.js'
import { requireRole } from '../lib/requireRole.js'
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js'
import {
  listExtractedRequirements,
  getExtractedRequirement,
  listRequirementConflicts,
  getEvaluation,
  listEvaluationCriteria,
  listEvaluationConflicts,
  listExtractionRuns,
} from '../repositories/tenderRequirementsEvaluation.js'
import { createSupabaseRequirementEvaluationStore } from '../lib/ai/supabaseRequirementEvaluationStore.js'
import { createOpenAiClient } from '../lib/ai/client.js'
import { loadAiConfig, isAiConfigured } from '../lib/ai/config.js'
import { runRequirementEvaluationExtraction } from '../lib/ai/execution/runRequirementEvaluationExtraction.js'
import { AiRunAlreadyActiveError } from '../lib/ai/errors.js'
import { logger } from '../lib/logger.js'
import { recordAuditTrailEvent } from '../lib/auditTrail/writer.js'

const paramsSchema = z.object({ id: z.string().uuid() })
const requirementParamsSchema = z.object({ id: z.string().uuid(), requirementId: z.string().uuid() })
const criterionParamsSchema = z.object({ id: z.string().uuid(), criterionId: z.string().uuid() })

/**
 * Phase 9 §37 API. Reads go through the caller's own RLS-scoped client
 * (shared-catalogue — this data describes the tender's own document set,
 * not any one agency's evidence, so it is readable by any authenticated
 * user exactly like tender_requirements/tender_evaluation_criteria
 * themselves). Extraction/review writes run against the privileged
 * service-role client — same convention as Phase 7/8's routes.
 *
 * Job architecture (Phase 9 §50): extraction is fire-and-forget from the
 * route (no BullMQ in this codebase, confirmed unchanged in Phases 6-8) —
 * runRequirementEvaluationExtraction is the composable, idempotent,
 * retryable stage function a future worker would call.
 */
export async function tenderRequirementsEvaluationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth)

  app.get('/api/tenders/:id/requirements', async (request, reply) => {
    if (!requireRole(request, reply, REQUIREMENT_EVALUATION_VIEW_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id: tenderId } = paramsSchema.parse(request.params)
    const [requirements, conflicts] = await Promise.all([listExtractedRequirements(supabase, tenderId), listRequirementConflicts(supabase, tenderId)])
    return { requirements, conflicts }
  })

  app.get('/api/tenders/:id/requirements/:requirementId', async (request, reply) => {
    if (!requireRole(request, reply, REQUIREMENT_EVALUATION_VIEW_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id: tenderId, requirementId } = requirementParamsSchema.parse(request.params)
    const requirement = await getExtractedRequirement(supabase, tenderId, requirementId)
    if (!requirement) {
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Requirement not found for this tender.' } })
      return
    }
    return requirement
  })

  app.get('/api/tenders/:id/requirements/runs', async (request, reply) => {
    if (!requireRole(request, reply, REQUIREMENT_EVALUATION_VIEW_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id: tenderId } = paramsSchema.parse(request.params)
    return listExtractionRuns(supabase, tenderId)
  })

  app.post('/api/tenders/:id/requirements/extract', async (request, reply) => {
    if (!requireRole(request, reply, REQUIREMENT_EVALUATION_ACTION_ROLES)) return
    const { id: tenderId } = paramsSchema.parse(request.params)

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

    const store = createSupabaseRequirementEvaluationStore(admin)
    const client = createOpenAiClient(config.apiKey!)

    try {
      const active = await store.findActiveExtractionRun(tenderId)
      if (active) {
        reply.code(409).send({ error: { code: 'RUN_ALREADY_ACTIVE', message: 'A requirement/evaluation extraction run is already in progress for this tender.', runId: active.id } })
        return
      }
    } catch (err) {
      logger.error({ err, tenderId }, 'failed to check for an active extraction run')
      reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Could not check run status.' } })
      return
    }

    // Fire-and-forget (Phase 9 §50) — the run's own row is the client's
    // progress signal, polled via GET /api/tenders/:id/requirements/runs.
    runRequirementEvaluationExtraction({ store, client, config }, { tenderId, triggeredBy: request.user?.id ?? null }).catch((err) => {
      if (err instanceof AiRunAlreadyActiveError) return
      logger.error({ err, tenderId }, 'requirement/evaluation extraction run failed outside the handled lifecycle')
    })

    // Phase 20 §4D — chain-of-custody: REQUIREMENT_EXTRACTION stage,
    // correlated by tenderId (a bid project may not exist yet at this
    // point in the lineage).
    await recordAuditTrailEvent(admin, {
      correlationId: tenderId,
      agencyId: null,
      stage: 'REQUIREMENT_EXTRACTION',
      entityType: 'tenders',
      entityId: tenderId,
      actorType: 'USER',
      actorId: request.user?.id ?? null,
      summary: 'Requirement/evaluation extraction run queued.',
    })

    reply.code(202).send({ status: 'QUEUED', tenderId })
  })

  app.get('/api/tenders/:id/evaluation', async (request, reply) => {
    if (!requireRole(request, reply, REQUIREMENT_EVALUATION_VIEW_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id: tenderId } = paramsSchema.parse(request.params)
    return getEvaluation(supabase, tenderId)
  })

  app.get('/api/tenders/:id/evaluation/criteria', async (request, reply) => {
    if (!requireRole(request, reply, REQUIREMENT_EVALUATION_VIEW_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id: tenderId } = paramsSchema.parse(request.params)
    return listEvaluationCriteria(supabase, tenderId)
  })

  app.get('/api/tenders/:id/evaluation/conflicts', async (request, reply) => {
    if (!requireRole(request, reply, REQUIREMENT_EVALUATION_VIEW_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id: tenderId } = paramsSchema.parse(request.params)
    return listEvaluationConflicts(supabase, tenderId)
  })

  // Human review (Phase 9 §41) — append-only, never overwrites the
  // original AI extraction. Mirrors routes/tenderQualification.ts's
  // review endpoint exactly.
  app.post('/api/tenders/:id/requirements/:requirementId/review', async (request, reply) => {
    if (!requireRole(request, reply, REQUIREMENT_EVALUATION_ACTION_ROLES)) return
    const { id: tenderId, requirementId } = requirementParamsSchema.parse(request.params)
    const userId = request.user?.id
    if (!userId) {
      reply.code(422).send({ error: { code: 'NO_USER', message: 'Your account could not be identified.' } })
      return
    }
    const body = submitRequirementReviewSchema.parse(request.body)
    const admin = getSupabaseAdmin()
    if (!admin) {
      reply.code(503).send({ error: { code: 'DATABASE_NOT_CONFIGURED', message: 'Supabase is not configured yet.' } })
      return
    }
    const { data, error } = await admin
      .from('tender_requirement_reviews')
      .insert({ requirement_id: requirementId, tender_id: tenderId, reviewer_id: userId, decision: body.decision, note: body.note ?? null })
      .select('*')
      .single()
    if (error) {
      logger.error({ err: error, tenderId, requirementId }, 'failed to record requirement review')
      reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Could not record review.' } })
      return
    }
    reply.code(201).send(data)
  })

  app.post('/api/tenders/:id/evaluation/criteria/:criterionId/review', async (request, reply) => {
    if (!requireRole(request, reply, REQUIREMENT_EVALUATION_ACTION_ROLES)) return
    const { id: tenderId, criterionId } = criterionParamsSchema.parse(request.params)
    const userId = request.user?.id
    if (!userId) {
      reply.code(422).send({ error: { code: 'NO_USER', message: 'Your account could not be identified.' } })
      return
    }
    const body = submitEvaluationCriterionReviewSchema.parse(request.body)
    const admin = getSupabaseAdmin()
    if (!admin) {
      reply.code(503).send({ error: { code: 'DATABASE_NOT_CONFIGURED', message: 'Supabase is not configured yet.' } })
      return
    }
    const { data, error } = await admin
      .from('tender_evaluation_criteria_reviews')
      .insert({ criterion_id: criterionId, tender_id: tenderId, reviewer_id: userId, decision: body.decision, note: body.note ?? null })
      .select('*')
      .single()
    if (error) {
      logger.error({ err: error, tenderId, criterionId }, 'failed to record evaluation criterion review')
      reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Could not record review.' } })
      return
    }
    reply.code(201).send(data)
  })
}
