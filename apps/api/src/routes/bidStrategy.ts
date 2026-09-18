import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { BID_STRATEGY_VIEW_ROLES, BID_STRATEGY_MANAGE_ROLES, BID_STRATEGY_APPROVE_ROLES, BID_PROJECT_REVIEW_OVERRIDE_ROLES, BID_PROJECT_TRANSITIONS, type BidProjectStatus } from '@tender-os/constants'
import { createBidProjectRequestSchema, createBidTaskRequestSchema, createBidQuestionRequestSchema, updateBidProjectStatusRequestSchema } from '@tender-os/schemas'
import { requireAuth } from '../middleware/auth.js'
import { requireSupabase } from '../lib/requireSupabase.js'
import { requireRole } from '../lib/requireRole.js'
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js'
import { canCreateBidProject } from '../lib/bidStrategy/projectGate.js'
import { createSupabaseBidStrategyStore } from '../lib/bidStrategy/supabaseBidStrategyStore.js'
import * as repo from '../repositories/bidStrategy.js'
import { logger } from '../lib/logger.js'
import { recordAuditTrailEvent } from '../lib/auditTrail/writer.js'

const paramsSchema = z.object({ id: z.string().uuid() })

/**
 * Phase 12 §36 API. NAMING NOTE (documented in docs/DECISIONS.md, same
 * discipline as Phase 10/11): `/api/bids` and `/api/bids/:id` are
 * free — routes/ has no pre-existing route under that prefix (checked
 * first, per the binding spec); the web app's placeholder pages at
 * ROUTE_PATTERNS.bids/.bidDetail already expect this exact path
 * shape. `/api/tenders/:id/bid-project` also verified free.
 *
 * Reads go through the caller's own RLS-scoped client (agency-isolated,
 * same convention as every prior phase's GET routes). Every mutation
 * (project creation, strategy generate/approve, task/question
 * creation, status transitions) runs against the privileged
 * service-role client only after this file has already checked role +
 * business rules — never a client-supplied arbitrary payload straight
 * to the DB (Phase 12 §38).
 */
export async function bidStrategyRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth)

  function agencyOf(request: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply): string | null {
    const agencyId = request.user?.agencyId
    if (!agencyId) {
      reply.code(422).send({ error: { code: 'NO_AGENCY', message: 'Your account is not associated with an agency.' } })
      return null
    }
    return agencyId
  }

  /** Resource-ownership guard: loads the project and 404s/403s if it doesn't belong to the caller's agency (Phase 12 §37 — agency identity never trusted from the URL alone). */
  async function loadOwnedProject(request: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply, supabase: ReturnType<typeof requireSupabase>, projectId: string) {
    if (!supabase) return null
    const agencyId = agencyOf(request, reply)
    if (!agencyId) return null
    const project = await repo.getBidProject(supabase, projectId)
    if (!project || project.agency_id !== agencyId) {
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Bid project not found.' } })
      return null
    }
    return project
  }

  // -----------------------------------------------------------------
  // POST /api/tenders/:id/bid-project — Phase 12 §5 create-gate.
  // -----------------------------------------------------------------
  app.post('/api/tenders/:id/bid-project', async (request, reply) => {
    if (!requireRole(request, reply, BID_STRATEGY_MANAGE_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const agencyId = agencyOf(request, reply)
    if (!agencyId) return
    const admin = getSupabaseAdmin()
    if (!admin) {
      reply.code(503).send({ error: { code: 'DATABASE_NOT_CONFIGURED', message: 'Supabase is not configured yet.' } })
      return
    }
    const { id: tenderId } = paramsSchema.parse(request.params)
    const body = createBidProjectRequestSchema.parse(request.body ?? {})

    const store = createSupabaseBidStrategyStore(admin)
    const decisionRun = await store.fetchBidDecisionRun(tenderId, agencyId)

    const authorizedFromReview = Boolean(body.authorizedFromReview) && BID_PROJECT_REVIEW_OVERRIDE_ROLES.includes(request.user!.role as (typeof BID_PROJECT_REVIEW_OVERRIDE_ROLES)[number])
    const gate = canCreateBidProject({ finalDecision: (decisionRun?.final_decision as 'BID' | 'REVIEW' | 'NO_BID' | null) ?? null, authorizedFromReview })
    if (!gate.allowed) {
      reply.code(gate.httpStatus).send({ error: { code: 'BID_PROJECT_CREATION_BLOCKED', message: gate.reason } })
      return
    }

    const { data: tender } = await supabase.from('tenders').select('title').eq('id', tenderId).maybeSingle()
    const project = await store.createBidProject({
      tenderId,
      agencyId,
      decisionRunId: decisionRun!.id,
      projectName: body.projectName ?? `Bid: ${tender?.title ?? tenderId}`,
      ownerUserId: body.ownerUserId ?? request.user!.id,
      targetSubmissionDate: body.targetSubmissionDate ?? null,
      priority: body.priority ?? 'MEDIUM',
      createdBy: request.user!.id,
    })

    reply.code(201).send(project)
  })

  // -----------------------------------------------------------------
  // GET /api/bids, GET /api/bids/:id
  // -----------------------------------------------------------------
  app.get('/api/bids', async (request, reply) => {
    if (!requireRole(request, reply, BID_STRATEGY_VIEW_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const agencyId = agencyOf(request, reply)
    if (!agencyId) return
    const rows = await repo.listBidProjects(supabase, agencyId)
    return { rows }
  })

  app.get('/api/bids/:id', async (request, reply) => {
    if (!requireRole(request, reply, BID_STRATEGY_VIEW_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id } = paramsSchema.parse(request.params)
    const project = await loadOwnedProject(request, reply, supabase, id)
    if (!project) return
    return project
  })

  app.post('/api/bids/:id/status', async (request, reply) => {
    if (!requireRole(request, reply, BID_STRATEGY_MANAGE_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id } = paramsSchema.parse(request.params)
    const project = await loadOwnedProject(request, reply, supabase, id)
    if (!project) return
    const { status: toStatus } = updateBidProjectStatusRequestSchema.parse(request.body)
    const fromStatus = project.status as BidProjectStatus
    const allowed = BID_PROJECT_TRANSITIONS[fromStatus] ?? []
    if (!allowed.includes(toStatus)) {
      reply.code(409).send({ error: { code: 'INVALID_STATUS_TRANSITION', message: `Cannot transition a Bid Project from ${fromStatus} to ${toStatus}.` } })
      return
    }
    const admin = getSupabaseAdmin()
    if (!admin) {
      reply.code(503).send({ error: { code: 'DATABASE_NOT_CONFIGURED', message: 'Supabase is not configured yet.' } })
      return
    }
    const store = createSupabaseBidStrategyStore(admin)
    const updated = await store.transitionProjectStatus(id, project.agency_id, fromStatus, toStatus, request.user!.id)
    return updated
  })

  // -----------------------------------------------------------------
  // Strategy
  // -----------------------------------------------------------------
  app.get('/api/bids/:id/strategy', async (request, reply) => {
    if (!requireRole(request, reply, BID_STRATEGY_VIEW_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id } = paramsSchema.parse(request.params)
    const project = await loadOwnedProject(request, reply, supabase, id)
    if (!project) return
    const current = await repo.getCurrentStrategy(supabase, id)
    const history = await repo.listStrategyHistory(supabase, id)
    return { current, history }
  })

  app.post('/api/bids/:id/strategy/generate', async (request, reply) => {
    if (!requireRole(request, reply, BID_STRATEGY_MANAGE_ROLES)) return
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
    const store = createSupabaseBidStrategyStore(admin)
    try {
      const result = await store.generateStrategy(id, project.tender_id, project.agency_id, request.user!.id)
      // Phase 20 §4D — STRATEGY_GENERATION stage, correlated by the
      // bid project (the lineage's identity from this point onward).
      await recordAuditTrailEvent(admin, {
        correlationId: id,
        agencyId: project.agency_id,
        stage: 'STRATEGY_GENERATION',
        entityType: 'bid_strategy_projects',
        entityId: id,
        actorType: 'USER',
        actorId: request.user!.id,
        summary: 'Bid strategy generated.',
      })
      reply.code(201).send(result)
    } catch (err) {
      logger.error({ err, projectId: id }, 'strategy generation failed')
      reply.code(500).send({ error: { code: 'STRATEGY_GENERATION_FAILED', message: err instanceof Error ? err.message : 'Strategy generation failed.' } })
    }
  })

  app.post('/api/bids/:id/strategy/approve', async (request, reply) => {
    if (!requireRole(request, reply, BID_STRATEGY_APPROVE_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id } = paramsSchema.parse(request.params)
    const project = await loadOwnedProject(request, reply, supabase, id)
    if (!project) return
    const current = await repo.getCurrentStrategy(supabase, id)
    if (!current) {
      reply.code(404).send({ error: { code: 'NO_STRATEGY', message: 'No current strategy exists for this bid project.' } })
      return
    }
    const readiness = await repo.computeReadiness(supabase, id)
    const body = z.object({ overrideBlockers: z.boolean().optional(), overrideReason: z.string().optional() }).parse(request.body ?? {})
    const hasCriticalBlockers = (readiness?.blockers.length ?? 0) > 0
    // Phase 12 §25 (binding constraint): a strategy cannot be approved
    // while critical blockers exist, UNLESS an ADMIN explicitly passes
    // overrideBlockers=true with a non-empty overrideReason — documented,
    // audited override, never a silent bypass.
    if (hasCriticalBlockers) {
      const canOverride = request.user!.role === 'ADMIN' && body.overrideBlockers === true && Boolean(body.overrideReason && body.overrideReason.trim().length > 0)
      if (!canOverride) {
        reply.code(409).send({ error: { code: 'STRATEGY_APPROVAL_BLOCKED', message: 'This strategy has unresolved readiness blockers and cannot be approved without an authorized ADMIN override (overrideBlockers=true, overrideReason required).', blockers: readiness?.blockers ?? [] } })
        return
      }
    }
    const admin = getSupabaseAdmin()
    if (!admin) {
      reply.code(503).send({ error: { code: 'DATABASE_NOT_CONFIGURED', message: 'Supabase is not configured yet.' } })
      return
    }
    const store = createSupabaseBidStrategyStore(admin)
    const approved = await store.approveStrategy(current.strategy.id, project.agency_id, request.user!.id)
    return approved
  })

  // -----------------------------------------------------------------
  // Evaluation / Requirements / Evidence Needs
  // -----------------------------------------------------------------
  app.get('/api/bids/:id/evaluation', async (request, reply) => {
    if (!requireRole(request, reply, BID_STRATEGY_VIEW_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id } = paramsSchema.parse(request.params)
    const project = await loadOwnedProject(request, reply, supabase, id)
    if (!project) return
    const rows = await repo.getEvaluationStrategies(supabase, id)
    return { rows }
  })

  app.get('/api/bids/:id/requirements', async (request, reply) => {
    if (!requireRole(request, reply, BID_STRATEGY_VIEW_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id } = paramsSchema.parse(request.params)
    const project = await loadOwnedProject(request, reply, supabase, id)
    if (!project) return
    const rows = await repo.getRequirementPlans(supabase, id)
    return { rows }
  })

  app.get('/api/bids/:id/evidence-needs', async (request, reply) => {
    if (!requireRole(request, reply, BID_STRATEGY_VIEW_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id } = paramsSchema.parse(request.params)
    const project = await loadOwnedProject(request, reply, supabase, id)
    if (!project) return
    const rows = await repo.getEvidenceNeeds(supabase, id)
    return { rows }
  })

  // -----------------------------------------------------------------
  // Tasks / Milestones
  // -----------------------------------------------------------------
  app.get('/api/bids/:id/tasks', async (request, reply) => {
    if (!requireRole(request, reply, BID_STRATEGY_VIEW_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id } = paramsSchema.parse(request.params)
    const project = await loadOwnedProject(request, reply, supabase, id)
    if (!project) return
    const rows = await repo.listTasks(supabase, id)
    return { rows }
  })

  app.post('/api/bids/:id/tasks', async (request, reply) => {
    if (!requireRole(request, reply, BID_STRATEGY_MANAGE_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id } = paramsSchema.parse(request.params)
    const project = await loadOwnedProject(request, reply, supabase, id)
    if (!project) return
    const body = createBidTaskRequestSchema.parse(request.body)
    const admin = getSupabaseAdmin()
    if (!admin) {
      reply.code(503).send({ error: { code: 'DATABASE_NOT_CONFIGURED', message: 'Supabase is not configured yet.' } })
      return
    }
    const store = createSupabaseBidStrategyStore(admin)
    const task = await store.createTask(
      id,
      project.agency_id,
      { workstream_id: body.workstreamId ?? null, title: body.title, description: body.description ?? null, task_type: body.taskType, owner_user_id: body.ownerUserId ?? null, priority: body.priority ?? 'MEDIUM', due_date: body.dueDate ?? null, dependency_task_id: body.dependencyTaskId ?? null },
      request.user!.id,
    )
    reply.code(201).send(task)
  })

  app.get('/api/bids/:id/milestones', async (request, reply) => {
    if (!requireRole(request, reply, BID_STRATEGY_VIEW_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id } = paramsSchema.parse(request.params)
    const project = await loadOwnedProject(request, reply, supabase, id)
    if (!project) return
    const rows = await repo.listMilestones(supabase, id)
    return { rows }
  })

  // -----------------------------------------------------------------
  // Questions / Risks / Readiness
  // -----------------------------------------------------------------
  app.get('/api/bids/:id/questions', async (request, reply) => {
    if (!requireRole(request, reply, BID_STRATEGY_VIEW_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id } = paramsSchema.parse(request.params)
    const project = await loadOwnedProject(request, reply, supabase, id)
    if (!project) return
    const rows = await repo.listQuestions(supabase, id)
    return { rows }
  })

  app.post('/api/bids/:id/questions', async (request, reply) => {
    if (!requireRole(request, reply, BID_STRATEGY_VIEW_ROLES)) return // RESEARCHER may contribute questions (Phase 12 §24)
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id } = paramsSchema.parse(request.params)
    const project = await loadOwnedProject(request, reply, supabase, id)
    if (!project) return
    const body = createBidQuestionRequestSchema.parse(request.body)
    const admin = getSupabaseAdmin()
    if (!admin) {
      reply.code(503).send({ error: { code: 'DATABASE_NOT_CONFIGURED', message: 'Supabase is not configured yet.' } })
      return
    }
    const store = createSupabaseBidStrategyStore(admin)
    // Phase 12 §29 (binding constraint): the system never invents a
    // question or answer — this endpoint only stores the human-authored
    // text passed in the request; answer/answerSource are never accepted here.
    const question = await store.createQuestion(id, project.agency_id, { question: body.question, context: body.context ?? null, source_requirement_id: body.sourceRequirementId ?? null, source_evaluation_criterion_id: body.sourceEvaluationCriterionId ?? null, assigned_to: body.assignedTo ?? null, due_date: body.dueDate ?? null }, request.user!.id)
    reply.code(201).send(question)
  })

  app.get('/api/bids/:id/risks', async (request, reply) => {
    if (!requireRole(request, reply, BID_STRATEGY_VIEW_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id } = paramsSchema.parse(request.params)
    const project = await loadOwnedProject(request, reply, supabase, id)
    if (!project) return
    const rows = await repo.listRisks(supabase, id)
    return { rows }
  })

  app.get('/api/bids/:id/readiness', async (request, reply) => {
    if (!requireRole(request, reply, BID_STRATEGY_VIEW_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id } = paramsSchema.parse(request.params)
    const project = await loadOwnedProject(request, reply, supabase, id)
    if (!project) return
    const readiness = await repo.computeReadiness(supabase, id)
    return readiness
  })
}
