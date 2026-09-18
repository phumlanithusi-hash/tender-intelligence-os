import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { PROPOSAL_VIEW_ROLES, PROPOSAL_EDIT_ROLES, PROPOSAL_REVIEW_ROLES } from '@tender-os/constants'
import { generateProposalSectionRequestSchema, patchProposalSectionRequestSchema, rejectProposalSectionRequestSchema, reviewProposalSectionRequestSchema, assembleProposalDocumentRequestSchema, createProposalSectionRequestSchema } from '@tender-os/schemas'
import { requireAuth } from '../middleware/auth.js'
import { requireSupabase } from '../lib/requireSupabase.js'
import { requireRole } from '../lib/requireRole.js'
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js'
import { getBidProject } from '../repositories/bidStrategy.js'
import { createSupabaseProposalStore } from '../lib/proposals/supabaseProposalStore.js'
import { createOpenAiClient } from '../lib/ai/client.js'
import { loadAiConfig } from '../lib/ai/config.js'
import { logger } from '../lib/logger.js'

const paramsSchema = z.object({ id: z.string().uuid() })
const sectionParamsSchema = z.object({ id: z.string().uuid(), sectionId: z.string().uuid() })

/**
 * Phase 14 API. NAMING NOTE (checked first, per the binding spec):
 * `apps/api/src/routes/` was searched for `proposal` before writing a
 * single route and nothing collided — `/api/bids/:id/proposal...` is
 * free, so the spec's literal §36 paths are used verbatim, mirroring
 * routes/evidenceMatching.ts and routes/bidStrategy.ts exactly.
 *
 * RESEARCHER may draft sections and trigger generation but never
 * review/approve/reject (Phase 14 §32/§16, mirrors Phase 13's
 * view/generate/decide role split for evidence matches).
 */
export async function proposalsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth)

  function agencyOf(request: FastifyRequest, reply: FastifyReply): string | null {
    const agencyId = request.user?.agencyId
    if (!agencyId) {
      reply.code(422).send({ error: { code: 'NO_AGENCY', message: 'Your account is not associated with an agency.' } })
      return null
    }
    return agencyId
  }

  async function loadOwnedProject(request: FastifyRequest, reply: FastifyReply, supabase: ReturnType<typeof requireSupabase>, projectId: string) {
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

  /** Loads a section and verifies it belongs to a proposal owned by the caller's agency — never trusts a bare sectionId against another agency's data (Phase 14 §34/§35). */
  async function loadOwnedSection(supabase: ReturnType<typeof requireSupabase>, reply: FastifyReply, agencyId: string, sectionId: string) {
    if (!supabase) return null
    const { data, error } = await supabase.from('bid_proposal_sections').select('*').eq('id', sectionId).eq('agency_id', agencyId).maybeSingle()
    if (error) {
      reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Could not load this section.' } })
      return null
    }
    if (!data) {
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Proposal section not found.' } })
      return null
    }
    return data
  }

  function adminStore() {
    const admin = getSupabaseAdmin()
    if (!admin) return null
    return createSupabaseProposalStore(admin)
  }

  // -----------------------------------------------------------------
  // GET/POST /api/bids/:id/proposal
  // -----------------------------------------------------------------
  app.get('/api/bids/:id/proposal', async (request, reply) => {
    if (!requireRole(request, reply, PROPOSAL_VIEW_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id } = paramsSchema.parse(request.params)
    const project = await loadOwnedProject(request, reply, supabase, id)
    if (!project) return
    const { data, error } = await supabase.from('bid_proposals').select('*').eq('bid_project_id', id).maybeSingle()
    if (error) {
      reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Could not load proposal.' } })
      return
    }
    if (!data) {
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'No proposal exists yet for this bid project.' } })
      return
    }
    const version = await supabase.from('bid_proposal_versions').select('*').eq('proposal_id', data.id).eq('is_current', true).maybeSingle()
    const sections = version.data ? await supabase.from('bid_proposal_sections').select('*').eq('proposal_version_id', version.data.id).order('sort_order', { ascending: true }) : { data: [] }
    return { proposal: data, currentVersion: version.data ?? null, sections: sections.data ?? [] }
  })

  app.post('/api/bids/:id/proposal', async (request, reply) => {
    if (!requireRole(request, reply, PROPOSAL_EDIT_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id } = paramsSchema.parse(request.params)
    const project = await loadOwnedProject(request, reply, supabase, id)
    if (!project) return

    const store = adminStore()
    if (!store) {
      reply.code(503).send({ error: { code: 'DATABASE_NOT_CONFIGURED', message: 'Supabase is not configured yet.' } })
      return
    }
    try {
      const proposal = await store.createProposal({ bidProjectId: id, tenderId: project.tender_id, agencyId: project.agency_id, createdBy: request.user!.id })
      reply.code(201).send(proposal)
    } catch (err) {
      logger.error({ err, bidProjectId: id }, 'proposal creation failed')
      reply.code(500).send({ error: { code: 'PROPOSAL_CREATION_FAILED', message: err instanceof Error ? err.message : 'Could not create the proposal.' } })
    }
  })

  // -----------------------------------------------------------------
  // GET /api/bids/:id/proposal/versions
  // -----------------------------------------------------------------
  app.get('/api/bids/:id/proposal/versions', async (request, reply) => {
    if (!requireRole(request, reply, PROPOSAL_VIEW_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id } = paramsSchema.parse(request.params)
    const project = await loadOwnedProject(request, reply, supabase, id)
    if (!project) return
    const proposal = await supabase.from('bid_proposals').select('id').eq('bid_project_id', id).maybeSingle()
    if (!proposal.data) return { rows: [] }
    const { data, error } = await supabase.from('bid_proposal_versions').select('*').eq('proposal_id', proposal.data.id).order('version', { ascending: false })
    if (error) {
      reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Could not list proposal versions.' } })
      return
    }
    return { rows: data ?? [] }
  })

  // -----------------------------------------------------------------
  // POST /api/bids/:id/proposal/sections
  // -----------------------------------------------------------------
  app.post('/api/bids/:id/proposal/sections', async (request, reply) => {
    if (!requireRole(request, reply, PROPOSAL_EDIT_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id } = paramsSchema.parse(request.params)
    const project = await loadOwnedProject(request, reply, supabase, id)
    if (!project) return
    const body = createProposalSectionRequestSchema.parse(request.body ?? {})

    const proposal = await supabase.from('bid_proposals').select('*').eq('bid_project_id', id).maybeSingle()
    if (!proposal.data) {
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Create the proposal before adding sections.' } })
      return
    }
    const version = await supabase.from('bid_proposal_versions').select('*').eq('proposal_id', proposal.data.id).eq('is_current', true).maybeSingle()
    if (!version.data) {
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'No current proposal version.' } })
      return
    }

    const store = adminStore()
    if (!store) {
      reply.code(503).send({ error: { code: 'DATABASE_NOT_CONFIGURED', message: 'Supabase is not configured yet.' } })
      return
    }
    try {
      const section = await store.createSection({
        versionId: version.data.id,
        agencyId: project.agency_id,
        sectionType: body.sectionType,
        sectionKey: `${body.sectionType.toLowerCase()}-${Date.now()}`,
        title: body.title,
        objective: body.objective ?? null,
        sortOrder: body.sortOrder ?? 999,
        isMandatory: body.isMandatory ?? false,
      })
      reply.code(201).send(section)
    } catch (err) {
      logger.error({ err, bidProjectId: id }, 'section creation failed')
      reply.code(500).send({ error: { code: 'SECTION_CREATION_FAILED', message: err instanceof Error ? err.message : 'Could not create the section.' } })
    }
  })

  // -----------------------------------------------------------------
  // GET /api/bids/:id/proposal/sections/:sectionId
  // -----------------------------------------------------------------
  app.get('/api/bids/:id/proposal/sections/:sectionId', async (request, reply) => {
    if (!requireRole(request, reply, PROPOSAL_VIEW_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id, sectionId } = sectionParamsSchema.parse(request.params)
    const project = await loadOwnedProject(request, reply, supabase, id)
    if (!project) return
    const section = await loadOwnedSection(supabase, reply, project.agency_id, sectionId)
    if (!section) return
    const [blocks, claims, reqLinks, evalLinks, generations] = await Promise.all([
      supabase.from('bid_proposal_blocks').select('*').eq('section_id', sectionId).order('sort_order', { ascending: true }),
      supabase.from('bid_proposal_claims').select('*').eq('section_id', sectionId),
      supabase.from('bid_proposal_requirement_links').select('*').eq('section_id', sectionId),
      supabase.from('bid_proposal_evaluation_links').select('*').eq('section_id', sectionId),
      supabase.from('bid_proposal_generations').select('*').eq('section_id', sectionId).order('created_at', { ascending: false }),
    ])
    return {
      section,
      blocks: blocks.data ?? [],
      claims: claims.data ?? [],
      requirementLinks: reqLinks.data ?? [],
      evaluationLinks: evalLinks.data ?? [],
      generations: generations.data ?? [],
    }
  })

  // -----------------------------------------------------------------
  // POST /api/bids/:id/proposal/sections/:sectionId/generate (and /regenerate — an alias, same handler)
  // -----------------------------------------------------------------
  async function handleGenerate(request: FastifyRequest, reply: FastifyReply) {
    if (!requireRole(request, reply, PROPOSAL_EDIT_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id, sectionId } = sectionParamsSchema.parse(request.params)
    const project = await loadOwnedProject(request, reply, supabase, id)
    if (!project) return
    const section = await loadOwnedSection(supabase, reply, project.agency_id, sectionId)
    if (!section) return
    const body = generateProposalSectionRequestSchema.parse(request.body ?? {})

    const store = adminStore()
    if (!store) {
      reply.code(503).send({ error: { code: 'DATABASE_NOT_CONFIGURED', message: 'Supabase is not configured yet.' } })
      return
    }
    const config = loadAiConfig()
    const client = createOpenAiClient(config.apiKey ?? '')
    try {
      const result = await store.generateSection({ client, config }, { sectionId, userId: request.user!.id, userInstructions: body.userInstructions ?? null })
      reply.code(200).send(result)
    } catch (err) {
      logger.error({ err, sectionId }, 'proposal section generation failed')
      reply.code(409).send({ error: { code: 'PROPOSAL_GENERATION_FAILED', message: err instanceof Error ? err.message : 'Could not generate this section.' } })
    }
  }
  app.post('/api/bids/:id/proposal/sections/:sectionId/generate', handleGenerate)
  app.post('/api/bids/:id/proposal/sections/:sectionId/regenerate', handleGenerate)

  // -----------------------------------------------------------------
  // PATCH /api/bids/:id/proposal/sections/:sectionId
  // -----------------------------------------------------------------
  app.patch('/api/bids/:id/proposal/sections/:sectionId', async (request, reply) => {
    if (!requireRole(request, reply, PROPOSAL_EDIT_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id, sectionId } = sectionParamsSchema.parse(request.params)
    const project = await loadOwnedProject(request, reply, supabase, id)
    if (!project) return
    const section = await loadOwnedSection(supabase, reply, project.agency_id, sectionId)
    if (!section) return
    const body = patchProposalSectionRequestSchema.parse(request.body ?? {})

    const store = adminStore()
    if (!store) {
      reply.code(503).send({ error: { code: 'DATABASE_NOT_CONFIGURED', message: 'Supabase is not configured yet.' } })
      return
    }
    try {
      const updated = await store.patchSection({ sectionId, userId: request.user!.id, title: body.title, objective: body.objective, blocks: body.blocks })
      reply.code(200).send(updated)
    } catch (err) {
      logger.error({ err, sectionId }, 'proposal section edit failed')
      reply.code(409).send({ error: { code: 'PROPOSAL_SECTION_EDIT_FAILED', message: err instanceof Error ? err.message : 'Could not edit this section.' } })
    }
  })

  // -----------------------------------------------------------------
  // POST .../review, /approve, /reject
  // -----------------------------------------------------------------
  async function handleReview(action: 'REVIEWED' | 'APPROVED' | 'REJECTED') {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      if (!requireRole(request, reply, PROPOSAL_REVIEW_ROLES)) return
      const supabase = requireSupabase(request, reply)
      if (!supabase) return
      const { id, sectionId } = sectionParamsSchema.parse(request.params)
      const project = await loadOwnedProject(request, reply, supabase, id)
      if (!project) return
      const section = await loadOwnedSection(supabase, reply, project.agency_id, sectionId)
      if (!section) return

      let reason: string | undefined
      if (action === 'REJECTED') {
        const body = rejectProposalSectionRequestSchema.safeParse(request.body)
        if (!body.success) {
          reply.code(422).send({ error: { code: 'VALIDATION_ERROR', message: 'A non-empty rejection reason is required.', issues: body.error.issues } })
          return
        }
        reason = body.data.reason
      } else {
        const body = reviewProposalSectionRequestSchema.safeParse(request.body ?? {})
        reason = body.success ? body.data.note : undefined
      }

      const store = adminStore()
      if (!store) {
        reply.code(503).send({ error: { code: 'DATABASE_NOT_CONFIGURED', message: 'Supabase is not configured yet.' } })
        return
      }
      try {
        const result = await store.reviewSection({ sectionId, reviewerId: request.user!.id, action, reason })
        reply.code(200).send(result)
      } catch (err) {
        logger.error({ err, sectionId, action }, 'proposal section review action failed')
        reply.code(409).send({ error: { code: 'PROPOSAL_REVIEW_FAILED', message: err instanceof Error ? err.message : 'Could not record this review action.' } })
      }
    }
  }
  app.post('/api/bids/:id/proposal/sections/:sectionId/review', await handleReview('REVIEWED'))
  app.post('/api/bids/:id/proposal/sections/:sectionId/approve', await handleReview('APPROVED'))
  app.post('/api/bids/:id/proposal/sections/:sectionId/reject', await handleReview('REJECTED'))

  // -----------------------------------------------------------------
  // GET/POST /api/bids/:id/proposal/compliance
  // -----------------------------------------------------------------
  app.get('/api/bids/:id/proposal/compliance', async (request, reply) => {
    if (!requireRole(request, reply, PROPOSAL_VIEW_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id } = paramsSchema.parse(request.params)
    const project = await loadOwnedProject(request, reply, supabase, id)
    if (!project) return
    const proposal = await supabase.from('bid_proposals').select('id').eq('bid_project_id', id).maybeSingle()
    if (!proposal.data) return { rows: [] }
    const version = await supabase.from('bid_proposal_versions').select('id').eq('proposal_id', proposal.data.id).eq('is_current', true).maybeSingle()
    if (!version.data) return { rows: [] }
    const { data, error } = await supabase.from('bid_proposal_compliance_results').select('*, bid_proposal_compliance_issues(*)').eq('proposal_version_id', version.data.id).order('computed_at', { ascending: false })
    if (error) {
      reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Could not list compliance results.' } })
      return
    }
    return { rows: data ?? [] }
  })

  app.post('/api/bids/:id/proposal/compliance/run', async (request, reply) => {
    if (!requireRole(request, reply, PROPOSAL_EDIT_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id } = paramsSchema.parse(request.params)
    const project = await loadOwnedProject(request, reply, supabase, id)
    if (!project) return
    const proposal = await supabase.from('bid_proposals').select('id').eq('bid_project_id', id).maybeSingle()
    if (!proposal.data) {
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'No proposal exists yet for this bid project.' } })
      return
    }
    const version = await supabase.from('bid_proposal_versions').select('id').eq('proposal_id', proposal.data.id).eq('is_current', true).maybeSingle()
    if (!version.data) {
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'No current proposal version.' } })
      return
    }
    const store = adminStore()
    if (!store) {
      reply.code(503).send({ error: { code: 'DATABASE_NOT_CONFIGURED', message: 'Supabase is not configured yet.' } })
      return
    }
    try {
      const result = await store.runCompliance({ versionId: version.data.id, computedBy: request.user!.id })
      reply.code(200).send(result)
    } catch (err) {
      logger.error({ err, bidProjectId: id }, 'proposal compliance run failed')
      reply.code(500).send({ error: { code: 'PROPOSAL_COMPLIANCE_FAILED', message: err instanceof Error ? err.message : 'Could not run compliance.' } })
    }
  })

  // -----------------------------------------------------------------
  // GET /api/bids/:id/proposal/claims
  // -----------------------------------------------------------------
  app.get('/api/bids/:id/proposal/claims', async (request, reply) => {
    if (!requireRole(request, reply, PROPOSAL_VIEW_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id } = paramsSchema.parse(request.params)
    const project = await loadOwnedProject(request, reply, supabase, id)
    if (!project) return
    const proposal = await supabase.from('bid_proposals').select('id').eq('bid_project_id', id).maybeSingle()
    if (!proposal.data) return { rows: [] }
    const version = await supabase.from('bid_proposal_versions').select('id').eq('proposal_id', proposal.data.id).eq('is_current', true).maybeSingle()
    if (!version.data) return { rows: [] }
    const sections = await supabase.from('bid_proposal_sections').select('id').eq('proposal_version_id', version.data.id)
    const sectionIds = (sections.data ?? []).map((s) => s.id)
    if (sectionIds.length === 0) return { rows: [] }
    const { data, error } = await supabase.from('bid_proposal_claims').select('*').in('section_id', sectionIds)
    if (error) {
      reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Could not list claims.' } })
      return
    }
    return { rows: data ?? [] }
  })

  // -----------------------------------------------------------------
  // GET /api/bids/:id/proposal/generations
  // -----------------------------------------------------------------
  app.get('/api/bids/:id/proposal/generations', async (request, reply) => {
    if (!requireRole(request, reply, PROPOSAL_VIEW_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id } = paramsSchema.parse(request.params)
    const project = await loadOwnedProject(request, reply, supabase, id)
    if (!project) return
    const proposal = await supabase.from('bid_proposals').select('id').eq('bid_project_id', id).maybeSingle()
    if (!proposal.data) return { rows: [] }
    const version = await supabase.from('bid_proposal_versions').select('id').eq('proposal_id', proposal.data.id).eq('is_current', true).maybeSingle()
    if (!version.data) return { rows: [] }
    const { data, error } = await supabase.from('bid_proposal_generations').select('*').eq('proposal_version_id', version.data.id).order('created_at', { ascending: false })
    if (error) {
      reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Could not list generations.' } })
      return
    }
    return { rows: data ?? [] }
  })

  // -----------------------------------------------------------------
  // POST /api/bids/:id/proposal/assemble
  // -----------------------------------------------------------------
  app.post('/api/bids/:id/proposal/assemble', async (request, reply) => {
    if (!requireRole(request, reply, PROPOSAL_EDIT_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id } = paramsSchema.parse(request.params)
    const project = await loadOwnedProject(request, reply, supabase, id)
    if (!project) return
    const body = assembleProposalDocumentRequestSchema.parse(request.body ?? {})
    const proposal = await supabase.from('bid_proposals').select('id').eq('bid_project_id', id).maybeSingle()
    if (!proposal.data) {
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'No proposal exists yet for this bid project.' } })
      return
    }
    const version = await supabase.from('bid_proposal_versions').select('id').eq('proposal_id', proposal.data.id).eq('is_current', true).maybeSingle()
    if (!version.data) {
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'No current proposal version.' } })
      return
    }
    const store = adminStore()
    if (!store) {
      reply.code(503).send({ error: { code: 'DATABASE_NOT_CONFIGURED', message: 'Supabase is not configured yet.' } })
      return
    }
    try {
      const { record, bytes, filename, contentType } = await store.assembleDocument({ versionId: version.data.id, format: body.format, userId: request.user!.id })
      reply
        .code(200)
        .header('Content-Type', contentType)
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .header('X-Proposal-Document-Id', record.id as string)
        .send(bytes)
    } catch (err) {
      logger.error({ err, bidProjectId: id }, 'proposal document assembly failed')
      reply.code(500).send({ error: { code: 'PROPOSAL_ASSEMBLY_FAILED', message: err instanceof Error ? err.message : 'Could not assemble the document.' } })
    }
  })
}
