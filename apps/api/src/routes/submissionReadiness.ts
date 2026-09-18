import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { SUBMISSION_VIEW_ROLES, SUBMISSION_MANAGE_ROLES, SUBMISSION_PRICING_ROLES, SUBMISSION_APPROVE_ROLES } from '@tender-os/constants'
import { createPricingRequestSchema, createPricingItemRequestSchema, updatePricingItemRequestSchema, createSubmissionApprovalRequestSchema, revokeSubmissionApprovalRequestSchema } from '@tender-os/schemas'
import { requireAuth } from '../middleware/auth.js'
import { requireSupabase } from '../lib/requireSupabase.js'
import { requireRole } from '../lib/requireRole.js'
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js'
import { createSupabaseSubmissionReadinessStore } from '../lib/submissionReadiness/supabaseSubmissionReadinessStore.js'
import { runSubmissionReadinessCheck, buildAndSaveSubmissionPack, approveForSubmission } from '../lib/submissionReadiness/runSubmissionReadiness.js'
import { buildPackFileRecord, buildSubmissionManifest, sha256Hex } from '../lib/submissionReadiness/pack.js'
import { logger } from '../lib/logger.js'
import { recordAuditTrailEvent } from '../lib/auditTrail/writer.js'

const paramsSchema = z.object({ id: z.string().uuid() })
const packParamsSchema = z.object({ id: z.string().uuid(), packId: z.string().uuid() })
const itemParamsSchema = z.object({ id: z.string().uuid(), itemId: z.string().uuid() })

/**
 * Phase 15 §54 API. NAMING NOTE (same discipline as Phase 12-14):
 * `/api/bids/:id/submission-readiness`,
 * `/api/bids/:id/submission-pack`, `/api/bids/:id/submission-manifest`,
 * `/api/bids/:id/pricing`, `/api/bids/:id/submission-approval` are all
 * verified free against routes/bidStrategy.ts (which already uses
 * `/api/bids/:id/readiness` for the DISTINCT Phase 12 bid-strategy
 * readiness concept — never confused with Phase 15 submission
 * readiness here).
 *
 * NO route in this file ever submits anything externally (spec §7/§54
 * binding constraint) — every endpoint only computes/persists internal
 * state and returns it.
 */
export async function submissionReadinessRoutes(app: FastifyInstance): Promise<void> {
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
    const { data: project } = await supabase.from('bid_strategy_projects').select('id, tender_id, agency_id').eq('id', projectId).maybeSingle()
    if (!project || project.agency_id !== agencyId) {
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Bid project not found.' } })
      return null
    }
    return project
  }

  function admin(reply: FastifyReply) {
    const client = getSupabaseAdmin()
    if (!client) {
      reply.code(503).send({ error: { code: 'DATABASE_NOT_CONFIGURED', message: 'Supabase is not configured yet.' } })
      return null
    }
    return client
  }

  // -----------------------------------------------------------------
  // Readiness
  // -----------------------------------------------------------------
  app.get('/api/bids/:id/submission-readiness', async (request, reply) => {
    if (!requireRole(request, reply, SUBMISSION_VIEW_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id } = paramsSchema.parse(request.params)
    const project = await loadOwnedProject(request, reply, supabase, id)
    if (!project) return
    const adminClient = admin(reply)
    if (!adminClient) return
    const store = createSupabaseSubmissionReadinessStore(adminClient)
    const readiness = await store.getCurrentReadiness(id)
    if (!readiness) return { readiness: null, items: [] }
    const items = await store.listReadinessItems(readiness.id)
    return { readiness, items }
  })

  app.get('/api/bids/:id/submission-readiness/items', async (request, reply) => {
    if (!requireRole(request, reply, SUBMISSION_VIEW_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id } = paramsSchema.parse(request.params)
    const project = await loadOwnedProject(request, reply, supabase, id)
    if (!project) return
    const adminClient = admin(reply)
    if (!adminClient) return
    const store = createSupabaseSubmissionReadinessStore(adminClient)
    const readiness = await store.getCurrentReadiness(id)
    if (!readiness) return { rows: [] }
    return { rows: await store.listReadinessItems(readiness.id) }
  })

  app.post('/api/bids/:id/submission-readiness/check', async (request, reply) => {
    if (!requireRole(request, reply, SUBMISSION_MANAGE_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id } = paramsSchema.parse(request.params)
    const project = await loadOwnedProject(request, reply, supabase, id)
    if (!project) return
    const adminClient = admin(reply)
    if (!adminClient) return
    const store = createSupabaseSubmissionReadinessStore(adminClient)
    try {
      const { readiness, result } = await runSubmissionReadinessCheck(store, { bidProjectId: id, agencyId: project.agency_id, tenderId: project.tender_id, nowIso: new Date().toISOString(), actorId: request.user!.id })
      const items = await store.listReadinessItems(readiness.id)
      reply.code(201).send({ readiness, result, items })
    } catch (err) {
      logger.error({ err, projectId: id }, 'submission readiness check failed')
      reply.code(500).send({ error: { code: 'SUBMISSION_READINESS_CHECK_FAILED', message: err instanceof Error ? err.message : 'Submission readiness check failed.' } })
    }
  })

  // -----------------------------------------------------------------
  // Pricing (Phase 15 §18/§19/§56 — commercially sensitive, restricted roles)
  // -----------------------------------------------------------------
  app.get('/api/bids/:id/pricing', async (request, reply) => {
    if (!requireRole(request, reply, SUBMISSION_PRICING_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id } = paramsSchema.parse(request.params)
    const project = await loadOwnedProject(request, reply, supabase, id)
    if (!project) return
    const adminClient = admin(reply)
    if (!adminClient) return
    const store = createSupabaseSubmissionReadinessStore(adminClient)
    return { pricing: await store.getCurrentPricing(id) }
  })

  app.post('/api/bids/:id/pricing', async (request, reply) => {
    if (!requireRole(request, reply, SUBMISSION_PRICING_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id } = paramsSchema.parse(request.params)
    const project = await loadOwnedProject(request, reply, supabase, id)
    if (!project) return
    const body = createPricingRequestSchema.parse(request.body ?? {})
    const adminClient = admin(reply)
    if (!adminClient) return
    const store = createSupabaseSubmissionReadinessStore(adminClient)
    const pricing = await store.createPricing(id, project.agency_id, body.currency ?? 'ZAR', request.user!.id)
    reply.code(201).send(pricing)
  })

  app.post('/api/bids/:id/pricing/items', async (request, reply) => {
    if (!requireRole(request, reply, SUBMISSION_PRICING_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id } = paramsSchema.parse(request.params)
    const project = await loadOwnedProject(request, reply, supabase, id)
    if (!project) return
    const adminClient = admin(reply)
    if (!adminClient) return
    const store = createSupabaseSubmissionReadinessStore(adminClient)
    let pricing = await store.getCurrentPricing(id)
    if (!pricing) pricing = await store.createPricing(id, project.agency_id, 'ZAR', request.user!.id)
    const body = createPricingItemRequestSchema.parse(request.body)
    const item = await store.upsertPricingItem(pricing.id, project.agency_id, { lineNumber: body.lineNumber, description: body.description, quantity: body.quantity, unit: body.unit ?? null, unitPrice: body.unitPrice, lineTotal: body.lineTotal, isMandatoryScheduleItem: body.isMandatoryScheduleItem ?? false, notes: body.notes ?? null })
    reply.code(201).send(item)
  })

  app.patch('/api/bids/:id/pricing/items/:itemId', async (request, reply) => {
    if (!requireRole(request, reply, SUBMISSION_PRICING_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id, itemId } = itemParamsSchema.parse(request.params)
    const project = await loadOwnedProject(request, reply, supabase, id)
    if (!project) return
    const body = updatePricingItemRequestSchema.parse(request.body)
    const adminClient = admin(reply)
    if (!adminClient) return
    const store = createSupabaseSubmissionReadinessStore(adminClient)
    try {
      const item = await store.updatePricingItem(itemId, project.agency_id, body)
      return item
    } catch (err) {
      reply.code(403).send({ error: { code: 'FORBIDDEN', message: err instanceof Error ? err.message : 'Forbidden.' } })
    }
  })

  // -----------------------------------------------------------------
  // Submission Pack + Manifest (Phase 15 §32/§33/§34/§35)
  // -----------------------------------------------------------------
  app.get('/api/bids/:id/submission-pack', async (request, reply) => {
    if (!requireRole(request, reply, SUBMISSION_VIEW_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id } = paramsSchema.parse(request.params)
    const project = await loadOwnedProject(request, reply, supabase, id)
    if (!project) return
    const adminClient = admin(reply)
    if (!adminClient) return
    const store = createSupabaseSubmissionReadinessStore(adminClient)
    return { pack: await store.getCurrentPack(id) }
  })

  app.get('/api/bids/:id/submission-pack/versions', async (request, reply) => {
    if (!requireRole(request, reply, SUBMISSION_VIEW_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id } = paramsSchema.parse(request.params)
    const project = await loadOwnedProject(request, reply, supabase, id)
    if (!project) return
    const adminClient = admin(reply)
    if (!adminClient) return
    const store = createSupabaseSubmissionReadinessStore(adminClient)
    return { rows: await store.listPackVersions(id) }
  })

  app.get('/api/bids/:id/submission-pack/:packId', async (request, reply) => {
    if (!requireRole(request, reply, SUBMISSION_VIEW_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id, packId } = packParamsSchema.parse(request.params)
    const project = await loadOwnedProject(request, reply, supabase, id)
    if (!project) return
    const adminClient = admin(reply)
    if (!adminClient) return
    const store = createSupabaseSubmissionReadinessStore(adminClient)
    const pack = await store.getPack(packId)
    if (!pack || pack.bidProjectId !== id) {
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Submission pack not found.' } })
      return
    }
    return pack
  })

  app.post('/api/bids/:id/submission-pack', async (request, reply) => {
    if (!requireRole(request, reply, SUBMISSION_MANAGE_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id } = paramsSchema.parse(request.params)
    const project = await loadOwnedProject(request, reply, supabase, id)
    if (!project) return
    const adminClient = admin(reply)
    if (!adminClient) return
    const store = createSupabaseSubmissionReadinessStore(adminClient)
    const readiness = await store.getCurrentReadiness(id)
    if (!readiness) {
      reply.code(409).send({ error: { code: 'NO_READINESS_SNAPSHOT', message: 'Run a submission readiness check before building a submission pack.' } })
      return
    }

    const [{ data: tender }, { data: proposalDocs }, pricing] = await Promise.all([
      supabase.from('tenders').select('title, tender_number, organisation, closing_date, closing_time, submission_method').eq('id', project.tender_id).maybeSingle(),
      readiness.proposalVersionId ? supabase.from('bid_proposal_documents').select('id, filename, storage_path, mime_type, file_hash, format').eq('proposal_version_id', readiness.proposalVersionId) : Promise.resolve({ data: [] }),
      store.getCurrentPricing(id),
    ])

    const files = (proposalDocs ?? []).map((d) => buildPackFileRecord({ documentType: `PROPOSAL_${d.format}`, fileName: d.filename, storagePath: d.storage_path, mimeType: d.mime_type, sizeBytes: null, precomputedSha256: d.file_hash ?? sha256Hex(Buffer.from(d.filename)), sourceTable: 'bid_proposal_documents', sourceId: d.id }))

    const manifest = buildSubmissionManifest({
      tenderTitle: tender?.title ?? 'Unknown tender',
      tenderNumber: (tender?.tender_number as string) ?? null,
      organisationName: tender?.organisation ?? 'Unknown organisation',
      closingDate: (tender?.closing_date as string) ?? null,
      closingTime: (tender?.closing_time as string) ?? null,
      submissionMethod: (tender?.submission_method as string) ?? 'UNKNOWN',
      documents: files.map((f) => ({ documentType: f.documentType, fileName: f.fileName, status: 'PRESENT', version: null, sizeBytes: f.sizeBytes, sha256: f.sha256, required: true, verified: false })),
      compliancePercentagesByCategory: {},
      overallStatus: readiness.status,
    })
    manifest.generatedAt = new Date().toISOString()

    try {
      const pack = await buildAndSaveSubmissionPack(store, { bidProjectId: id, agencyId: project.agency_id, readinessId: readiness.id, proposalVersionId: readiness.proposalVersionId, pricingId: pricing?.id ?? null, manifest, files, createdBy: request.user!.id })
      reply.code(201).send(pack)
    } catch (err) {
      logger.error({ err, projectId: id }, 'submission pack creation failed')
      reply.code(500).send({ error: { code: 'SUBMISSION_PACK_CREATION_FAILED', message: err instanceof Error ? err.message : 'Submission pack creation failed.' } })
    }
  })

  app.get('/api/bids/:id/submission-manifest', async (request, reply) => {
    if (!requireRole(request, reply, SUBMISSION_VIEW_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id } = paramsSchema.parse(request.params)
    const project = await loadOwnedProject(request, reply, supabase, id)
    if (!project) return
    const adminClient = admin(reply)
    if (!adminClient) return
    const store = createSupabaseSubmissionReadinessStore(adminClient)
    const pack = await store.getCurrentPack(id)
    return { manifest: pack?.manifest ?? null }
  })

  // -----------------------------------------------------------------
  // Final Approval (Phase 15 §37/§38/§39) — never a real submission.
  // -----------------------------------------------------------------
  app.post('/api/bids/:id/submission-approval', async (request, reply) => {
    if (!requireRole(request, reply, SUBMISSION_APPROVE_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id } = paramsSchema.parse(request.params)
    const project = await loadOwnedProject(request, reply, supabase, id)
    if (!project) return
    const body = createSubmissionApprovalRequestSchema.parse(request.body)
    const adminClient = admin(reply)
    if (!adminClient) return
    const store = createSupabaseSubmissionReadinessStore(adminClient)
    const readiness = await store.getCurrentReadiness(id)
    const pack = await store.getCurrentPack(id)
    if (!readiness || !pack) {
      reply.code(409).send({ error: { code: 'NOT_READY', message: 'A current readiness snapshot and submission pack are required before final approval.' } })
      return
    }
    const items = await store.listReadinessItems(readiness.id)
    const blockerCount = items.filter((i) => i.severity === 'BLOCKER').length
    try {
      const approval = await approveForSubmission(store, { bidProjectId: id, agencyId: project.agency_id, readiness, readinessBlockerCount: blockerCount, pack, approvalReason: body.approvalReason, actorId: request.user!.id, actorRole: request.user!.role, approveRoles: SUBMISSION_APPROVE_ROLES })
      // Phase 20 §4D — HUMAN_SIGNOFF stage: this is the exact human
      // approval gate the lineage viewer names.
      await recordAuditTrailEvent(adminClient, {
        correlationId: id,
        agencyId: project.agency_id,
        stage: 'HUMAN_SIGNOFF',
        entityType: 'bid_submission_approvals',
        entityId: approval.id,
        actorType: 'USER',
        actorId: request.user!.id,
        summary: 'Final submission approval signed off by an authorized human.',
      })
      // Never a real submission (§39/§63 binding constraint) — the
      // response explicitly says so for the UI to render verbatim.
      reply.code(201).send({ approval, message: 'READY FOR HUMAN SUBMISSION — this system has not submitted anything to any external portal, email, or agency.' })
    } catch (err) {
      reply.code(409).send({ error: { code: 'APPROVAL_BLOCKED', message: err instanceof Error ? err.message : 'Approval blocked.' } })
    }
  })

  app.post('/api/bids/:id/submission-approval/revoke', async (request, reply) => {
    if (!requireRole(request, reply, SUBMISSION_APPROVE_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id } = paramsSchema.parse(request.params)
    const project = await loadOwnedProject(request, reply, supabase, id)
    if (!project) return
    const body = revokeSubmissionApprovalRequestSchema.parse(request.body)
    const adminClient = admin(reply)
    if (!adminClient) return
    const store = createSupabaseSubmissionReadinessStore(adminClient)
    const active = await store.getActiveApproval(id)
    if (!active) {
      reply.code(404).send({ error: { code: 'NO_ACTIVE_APPROVAL', message: 'No active approval exists for this bid project.' } })
      return
    }
    const revoked = await store.revokeApproval(active.id, project.agency_id, request.user!.id, body.revokedReason)
    return revoked
  })
}
