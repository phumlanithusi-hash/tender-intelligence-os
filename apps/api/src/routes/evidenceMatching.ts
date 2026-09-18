import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { EVIDENCE_MATCH_VIEW_ROLES, EVIDENCE_MATCH_GENERATE_ROLES, EVIDENCE_MATCH_DECIDE_ROLES } from '@tender-os/constants'
import { generateEvidenceMatchesRequestSchema, rejectEvidenceMatchRequestSchema } from '@tender-os/schemas'
import { requireAuth } from '../middleware/auth.js'
import { requireSupabase } from '../lib/requireSupabase.js'
import { requireRole } from '../lib/requireRole.js'
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js'
import { getBidProject } from '../repositories/bidStrategy.js'
import { createSupabaseEvidenceMatchingStore } from '../lib/evidenceMatching/supabaseEvidenceMatchingStore.js'
import { createOpenAiEmbeddingClient } from '../lib/ai/embeddingClient.js'
import { loadAiConfig, isAiConfigured } from '../lib/ai/config.js'
import { logger } from '../lib/logger.js'
import { recordAuditTrailEvent } from '../lib/auditTrail/writer.js'

const paramsSchema = z.object({ id: z.string().uuid() })
const matchParamsSchema = z.object({ id: z.string().uuid(), matchId: z.string().uuid() })

/**
 * Phase 13 API. NAMING NOTE (checked first, per the binding spec):
 * `apps/api/src/routes/` was searched for `evidence-match`/
 * `evidence-claim`/`evidence-gap` before writing a single route and
 * nothing collided — `/api/bids/:id/evidence-matches...`,
 * `/api/bids/:id/evidence-claims`, `/api/bids/:id/evidence-gaps` are
 * all free, so the spec's literal §G paths are used verbatim (no
 * deviation needed here, unlike Phase 10's `/opportunity-score` or
 * Phase 9's requirements/evaluation route consolidation).
 *
 * Every mutating action (candidate generation — which calls the live
 * OpenAI embeddings endpoint — and approve/reject) runs against the
 * privileged service-role client, reached only after this file has
 * already checked role + agency ownership (Phase 13 §D/§G). AI/
 * semantic scoring can only ever produce CANDIDATE/REQUIRES_VERIFICATION/
 * VERIFIED (see lib/evidenceMatching/verifyEvidenceCandidate.ts) —
 * approve/reject are the only routes that can ever write APPROVED or
 * REJECTED, and both require a role in EVIDENCE_MATCH_DECIDE_ROLES.
 */
export async function evidenceMatchingRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth)

  function agencyOf(request: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply): string | null {
    const agencyId = request.user?.agencyId
    if (!agencyId) {
      reply.code(422).send({ error: { code: 'NO_AGENCY', message: 'Your account is not associated with an agency.' } })
      return null
    }
    return agencyId
  }

  async function loadOwnedProject(request: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply, supabase: ReturnType<typeof requireSupabase>, projectId: string) {
    if (!supabase) return null
    const agencyId = agencyOf(request, reply)
    if (!agencyId) return null
    const project = await getBidProject(supabase, projectId)
    if (!project || project.agency_id !== agencyId) {
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Bid project not found.' } })
      return null
    }
    return project
  }

  function buildStore() {
    const admin = getSupabaseAdmin()
    if (!admin) return { store: null, error: 'DATABASE_NOT_CONFIGURED' as const }
    const config = loadAiConfig()
    if (!isAiConfigured(config)) return { store: null, error: 'AI_NOT_CONFIGURED' as const }
    const embeddingClient = createOpenAiEmbeddingClient(config.apiKey!)
    return { store: createSupabaseEvidenceMatchingStore(admin, embeddingClient, config.embeddingModel), error: null }
  }

  // -----------------------------------------------------------------
  // GET/POST /api/bids/:id/evidence-matches
  // -----------------------------------------------------------------
  app.get('/api/bids/:id/evidence-matches', async (request, reply) => {
    if (!requireRole(request, reply, EVIDENCE_MATCH_VIEW_ROLES)) return
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
    const { data, error } = await admin.from('bid_evidence_matches').select('*').eq('bid_project_id', id).eq('agency_id', project.agency_id).order('created_at', { ascending: false })
    if (error) {
      reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Could not list evidence matches.' } })
      return
    }
    return { rows: data ?? [] }
  })

  app.post('/api/bids/:id/evidence-matches', async (request, reply) => {
    // Phase 13 §D (binding constraint): RESEARCHER may trigger
    // candidate generation ("suggest") but never decide.
    if (!requireRole(request, reply, EVIDENCE_MATCH_GENERATE_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id } = paramsSchema.parse(request.params)
    const project = await loadOwnedProject(request, reply, supabase, id)
    if (!project) return
    const body = generateEvidenceMatchesRequestSchema.parse(request.body ?? {})

    const { store, error } = buildStore()
    if (!store) {
      const code = error === 'AI_NOT_CONFIGURED' ? 422 : 503
      reply.code(code).send({ error: { code: error, message: error === 'AI_NOT_CONFIGURED' ? 'OPENAI_API_KEY is not configured — candidate generation requires a live embeddings call and cannot fabricate one.' : 'Supabase is not configured yet.' } })
      return
    }

    try {
      const results = await store.generateCandidatesForProject(id, project.agency_id, body.evidenceNeedId ?? null, request.user!.id)
      const admin = getSupabaseAdmin()
      if (admin) {
        // Phase 20 §4D — EVIDENCE_MATCH stage.
        await recordAuditTrailEvent(admin, {
          correlationId: id,
          agencyId: project.agency_id,
          stage: 'EVIDENCE_MATCH',
          entityType: 'bid_strategy_projects',
          entityId: id,
          actorType: 'USER',
          actorId: request.user!.id,
          summary: `Evidence match candidates generated (${results.length}).`,
        })
      }
      reply.code(201).send({ results })
    } catch (err) {
      logger.error({ err, projectId: id }, 'evidence match candidate generation failed')
      reply.code(500).send({ error: { code: 'EVIDENCE_MATCH_GENERATION_FAILED', message: err instanceof Error ? err.message : 'Candidate generation failed.' } })
    }
  })

  // -----------------------------------------------------------------
  // GET/POST /api/bids/:id/evidence-matches/:matchId
  // -----------------------------------------------------------------
  app.get('/api/bids/:id/evidence-matches/:matchId', async (request, reply) => {
    if (!requireRole(request, reply, EVIDENCE_MATCH_VIEW_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id, matchId } = matchParamsSchema.parse(request.params)
    const project = await loadOwnedProject(request, reply, supabase, id)
    if (!project) return
    const { data, error } = await supabase.from('bid_evidence_matches').select('*').eq('id', matchId).eq('bid_project_id', id).maybeSingle()
    if (error) {
      reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Could not load this evidence match.' } })
      return
    }
    if (!data) {
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Evidence match not found.' } })
      return
    }
    return data
  })

  app.post('/api/bids/:id/evidence-matches/:matchId/approve', async (request, reply) => {
    if (!requireRole(request, reply, EVIDENCE_MATCH_DECIDE_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id, matchId } = matchParamsSchema.parse(request.params)
    const project = await loadOwnedProject(request, reply, supabase, id)
    if (!project) return

    const admin = getSupabaseAdmin()
    if (!admin) {
      reply.code(503).send({ error: { code: 'DATABASE_NOT_CONFIGURED', message: 'Supabase is not configured yet.' } })
      return
    }
    // Approve/reject never need a live embeddings call — build the
    // store with a throwaway client that is never invoked.
    const store = createSupabaseEvidenceMatchingStore(admin, { embed: async () => [] }, 'unused')
    try {
      const updated = await store.approveMatch(matchId, project.agency_id, request.user!.id)
      reply.code(200).send(updated)
    } catch (err) {
      logger.error({ err, matchId }, 'evidence match approval failed')
      reply.code(409).send({ error: { code: 'EVIDENCE_MATCH_APPROVAL_FAILED', message: err instanceof Error ? err.message : 'Could not approve this evidence match.' } })
    }
  })

  app.post('/api/bids/:id/evidence-matches/:matchId/reject', async (request, reply) => {
    if (!requireRole(request, reply, EVIDENCE_MATCH_DECIDE_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id, matchId } = matchParamsSchema.parse(request.params)
    const project = await loadOwnedProject(request, reply, supabase, id)
    if (!project) return
    const body = rejectEvidenceMatchRequestSchema.safeParse(request.body)
    if (!body.success) {
      reply.code(422).send({ error: { code: 'VALIDATION_ERROR', message: 'A non-empty rejection reason is required.', issues: body.error.issues } })
      return
    }

    const admin = getSupabaseAdmin()
    if (!admin) {
      reply.code(503).send({ error: { code: 'DATABASE_NOT_CONFIGURED', message: 'Supabase is not configured yet.' } })
      return
    }
    const store = createSupabaseEvidenceMatchingStore(admin, { embed: async () => [] }, 'unused')
    try {
      const updated = await store.rejectMatch(matchId, project.agency_id, request.user!.id, body.data.reason)
      reply.code(200).send(updated)
    } catch (err) {
      logger.error({ err, matchId }, 'evidence match rejection failed')
      reply.code(409).send({ error: { code: 'EVIDENCE_MATCH_REJECTION_FAILED', message: err instanceof Error ? err.message : 'Could not reject this evidence match.' } })
    }
  })

  // -----------------------------------------------------------------
  // GET /api/bids/:id/evidence-claims
  // -----------------------------------------------------------------
  app.get('/api/bids/:id/evidence-claims', async (request, reply) => {
    if (!requireRole(request, reply, EVIDENCE_MATCH_VIEW_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id } = paramsSchema.parse(request.params)
    const project = await loadOwnedProject(request, reply, supabase, id)
    if (!project) return
    const { data, error } = await supabase.from('bid_evidence_claims').select('*').eq('bid_project_id', id).is('revoked_at', null).order('approved_at', { ascending: false })
    if (error) {
      reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Could not list evidence claims.' } })
      return
    }
    return { rows: data ?? [] }
  })

  // -----------------------------------------------------------------
  // GET /api/bids/:id/evidence-gaps — Phase 13 §E feedback loop.
  // -----------------------------------------------------------------
  app.get('/api/bids/:id/evidence-gaps', async (request, reply) => {
    if (!requireRole(request, reply, EVIDENCE_MATCH_VIEW_ROLES)) return
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
    const store = createSupabaseEvidenceMatchingStore(admin, { embed: async () => [] }, 'unused')
    try {
      const gaps = await store.computeGapsForProject(id, project.agency_id)
      return { rows: gaps }
    } catch (err) {
      logger.error({ err, projectId: id }, 'evidence gap computation failed')
      reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Could not compute evidence gaps.' } })
    }
  })
}
