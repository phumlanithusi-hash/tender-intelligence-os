import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { SUBMISSION_EXECUTION_VIEW_ROLES, SUBMISSION_EXECUTION_MANAGE_ROLES, SUBMISSION_EXECUTION_CONFIRM_ROLES } from '@tender-os/constants'
import { prepareSubmissionRequestSchema, confirmSubmissionRequestSchema, attemptSubmissionRequestSchema, manualCompleteSubmissionRequestSchema, cancelSubmissionRequestSchema, createSubmissionReceiptRequestSchema } from '@tender-os/schemas'
import { requireAuth } from '../middleware/auth.js'
import { requireSupabase } from '../lib/requireSupabase.js'
import { requireRole } from '../lib/requireRole.js'
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js'
import { createSupabaseSubmissionExecutionStore } from '../lib/submissions/supabaseSubmissionExecutionStore.js'
import { prepareSubmission, confirmSubmission, attemptSubmission, recordManualCompletion, captureReceipt, cancelSubmission, SubmissionBlockedError, SubmissionConflictError } from '../lib/submissions/runSubmission.js'
import { buildDefaultAdapterRegistry } from '../lib/submissions/registry.js'
import { logger } from '../lib/logger.js'
import { recordAuditTrailEvent } from '../lib/auditTrail/writer.js'

const paramsSchema = z.object({ id: z.string().uuid() })

/**
 * Phase 16 §26 API. Route paths were checked first against
 * routes/submissionReadiness.ts (which already owns
 * `/api/bids/:id/submission-readiness`, `/submission-pack`,
 * `/submission-manifest`, `/submission-approval`) and routes/bidStrategy.ts
 * (`/api/bids/:id/readiness`) before writing a single handler — none of
 * `/submission`, `/submission/prepare`, `/submission/confirm`,
 * `/submission/attempt`, `/submission/attempts`, `/submission/receipts`,
 * `/submission/manual-complete`, `/submission/cancel` collide with any
 * existing route, so the spec's §26 paths are used verbatim.
 *
 * Every handler re-derives agency ownership from the Supabase project
 * row (never trusts a client-supplied agencyId), and the deterministic
 * orchestration layer (lib/submissions/runSubmission.ts) re-validates
 * readiness/approval/pack/deadline/confirmation on every single call —
 * nothing here is ever cached client-side as authoritative.
 */
export async function submissionExecutionRoutes(app: FastifyInstance): Promise<void> {
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

  function handleError(reply: FastifyReply, err: unknown, fallbackCode: string) {
    if (err instanceof SubmissionBlockedError) {
      reply.code(409).send({ error: { code: 'SUBMISSION_BLOCKED', message: err.message, blockers: err.blockers } })
      return
    }
    if (err instanceof SubmissionConflictError) {
      reply.code(409).send({ error: { code: 'SUBMISSION_CONFLICT', message: err.message } })
      return
    }
    logger.error({ err }, 'submission execution route failed')
    reply.code(500).send({ error: { code: fallbackCode, message: err instanceof Error ? err.message : 'Unexpected error.' } })
  }

  // -----------------------------------------------------------------
  // GET /api/bids/:id/submission — full current state.
  // -----------------------------------------------------------------
  app.get('/api/bids/:id/submission', async (request, reply) => {
    if (!requireRole(request, reply, SUBMISSION_EXECUTION_VIEW_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id } = paramsSchema.parse(request.params)
    const project = await loadOwnedProject(request, reply, supabase, id)
    if (!project) return
    const adminClient = admin(reply)
    if (!adminClient) return
    const store = createSupabaseSubmissionExecutionStore(adminClient)
    const execution = await store.getExecution(id)
    if (!execution) return { execution: null, attempts: [], confirmations: [], receipts: [] }
    const [attempts, confirmations, receipts] = await Promise.all([store.listAttempts(execution.id), store.listConfirmations(execution.id), store.listReceipts(execution.id)])
    return { execution, attempts, confirmations, receipts }
  })

  app.post('/api/bids/:id/submission/prepare', async (request, reply) => {
    if (!requireRole(request, reply, SUBMISSION_EXECUTION_MANAGE_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id } = paramsSchema.parse(request.params)
    const project = await loadOwnedProject(request, reply, supabase, id)
    if (!project) return
    const body = prepareSubmissionRequestSchema.parse(request.body ?? {})
    const adminClient = admin(reply)
    if (!adminClient) return
    const store = createSupabaseSubmissionExecutionStore(adminClient)
    try {
      const execution = await prepareSubmission(store, {
        bidProjectId: id,
        agencyId: project.agency_id,
        documentEvidenceMethod: body.documentEvidenceMethod ?? null,
        manuallyConfirmedMethod: body.manuallyConfirmedMethod ?? null,
        supportedMethods: buildDefaultAdapterRegistry({ emailManifestFiles: [], emailOutgoingFiles: [], emailSubject: '', emailBody: '', emailSender: null, portalAutomation: null, portalAllowedHosts: [], apiClient: null, apiAllowedHosts: [], physicalDeliveryAddress: null }).supportedMethods,
        nowIso: new Date().toISOString(),
        actorId: request.user!.id,
      })
      reply.code(201).send({ execution })
    } catch (err) {
      handleError(reply, err, 'SUBMISSION_PREPARE_FAILED')
    }
  })

  app.post('/api/bids/:id/submission/confirm', async (request, reply) => {
    if (!requireRole(request, reply, SUBMISSION_EXECUTION_CONFIRM_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id } = paramsSchema.parse(request.params)
    const project = await loadOwnedProject(request, reply, supabase, id)
    if (!project) return
    const body = confirmSubmissionRequestSchema.parse(request.body)
    const adminClient = admin(reply)
    if (!adminClient) return
    const store = createSupabaseSubmissionExecutionStore(adminClient)
    try {
      const confirmation = await confirmSubmission(store, { bidProjectId: id, agencyId: project.agency_id, statement: body.statement, actorId: request.user!.id, nowIso: new Date().toISOString() })
      reply.code(201).send({ confirmation })
    } catch (err) {
      handleError(reply, err, 'SUBMISSION_CONFIRM_FAILED')
    }
  })

  app.post('/api/bids/:id/submission/attempt', async (request, reply) => {
    if (!requireRole(request, reply, SUBMISSION_EXECUTION_CONFIRM_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id } = paramsSchema.parse(request.params)
    const project = await loadOwnedProject(request, reply, supabase, id)
    if (!project) return
    const body = attemptSubmissionRequestSchema.parse(request.body ?? {})
    const adminClient = admin(reply)
    if (!adminClient) return
    const store = createSupabaseSubmissionExecutionStore(adminClient)
    // Phase 16 §48/§49: no live provider/portal automation, email
    // sender, or API client is configured anywhere in this build —
    // every method safely degrades to a guided MANUAL_REQUIRED
    // workflow rather than ever contacting a real external system.
    const registry = buildDefaultAdapterRegistry({ emailManifestFiles: [], emailOutgoingFiles: [], emailSubject: 'Bid submission', emailBody: 'Please find the attached bid submission pack.', emailSender: null, portalAutomation: null, portalAllowedHosts: [], apiClient: null, apiAllowedHosts: [], physicalDeliveryAddress: null })
    try {
      const attempt = await attemptSubmission(store, registry, { bidProjectId: id, agencyId: project.agency_id, actorId: request.user!.id, nowIso: new Date().toISOString(), explicitDuplicateOverride: body.explicitDuplicateOverride ?? false })
      reply.code(201).send({ attempt })
    } catch (err) {
      handleError(reply, err, 'SUBMISSION_ATTEMPT_FAILED')
    }
  })

  app.get('/api/bids/:id/submission/attempts', async (request, reply) => {
    if (!requireRole(request, reply, SUBMISSION_EXECUTION_VIEW_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id } = paramsSchema.parse(request.params)
    const project = await loadOwnedProject(request, reply, supabase, id)
    if (!project) return
    const adminClient = admin(reply)
    if (!adminClient) return
    const store = createSupabaseSubmissionExecutionStore(adminClient)
    const execution = await store.getExecution(id)
    if (!execution) return { rows: [] }
    return { rows: await store.listAttempts(execution.id) }
  })

  app.get('/api/bids/:id/submission/receipts', async (request, reply) => {
    if (!requireRole(request, reply, SUBMISSION_EXECUTION_VIEW_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id } = paramsSchema.parse(request.params)
    const project = await loadOwnedProject(request, reply, supabase, id)
    if (!project) return
    const adminClient = admin(reply)
    if (!adminClient) return
    const store = createSupabaseSubmissionExecutionStore(adminClient)
    const execution = await store.getExecution(id)
    if (!execution) return { rows: [] }
    return { rows: await store.listReceipts(execution.id) }
  })

  app.post('/api/bids/:id/submission/receipts', async (request, reply) => {
    if (!requireRole(request, reply, SUBMISSION_EXECUTION_MANAGE_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id } = paramsSchema.parse(request.params)
    const project = await loadOwnedProject(request, reply, supabase, id)
    if (!project) return
    const body = createSubmissionReceiptRequestSchema.parse(request.body)
    const adminClient = admin(reply)
    if (!adminClient) return
    const store = createSupabaseSubmissionExecutionStore(adminClient)
    try {
      const receipt = await captureReceipt(store, {
        bidProjectId: id,
        agencyId: project.agency_id,
        attemptId: body.attemptId ?? null,
        receiptType: body.receiptType,
        providerName: body.providerName ?? null,
        providerReference: body.providerReference ?? null,
        receiptUrl: body.receiptUrl ?? null,
        receiptFile: body.receiptFile ?? null,
        receiptHash: body.receiptHash ?? null,
        issuedAt: body.issuedAt ?? null,
        capturedBy: request.user!.id,
        providerIssued: body.providerIssued ?? false,
        notes: body.notes ?? null,
      })
      reply.code(201).send({ receipt })
    } catch (err) {
      handleError(reply, err, 'SUBMISSION_RECEIPT_FAILED')
    }
  })

  app.post('/api/bids/:id/submission/manual-complete', async (request, reply) => {
    if (!requireRole(request, reply, SUBMISSION_EXECUTION_MANAGE_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id } = paramsSchema.parse(request.params)
    const project = await loadOwnedProject(request, reply, supabase, id)
    if (!project) return
    const body = manualCompleteSubmissionRequestSchema.parse(request.body ?? {})
    const adminClient = admin(reply)
    if (!adminClient) return
    const store = createSupabaseSubmissionExecutionStore(adminClient)
    try {
      const execution = await recordManualCompletion(store, { bidProjectId: id, agencyId: project.agency_id, actorId: request.user!.id, nowIso: new Date().toISOString(), note: body.note ?? null })
      // Phase 20 §4D — SUBMISSION stage: the final link in the
      // lineage chain the audit viewer names.
      await recordAuditTrailEvent(adminClient, {
        correlationId: id,
        agencyId: project.agency_id,
        stage: 'SUBMISSION',
        entityType: 'bid_submission_executions',
        entityId: execution.id,
        actorType: 'USER',
        actorId: request.user!.id,
        summary: 'Bid submission reported by a human (pending independent verification).',
      })
      reply.code(201).send({ execution, message: 'SUBMISSION REPORTED — VERIFICATION REQUIRED. This system has recorded your report; it has not independently verified that the tendering authority received it. Capture a receipt/reference to move this to a verified SUBMITTED state.' })
    } catch (err) {
      handleError(reply, err, 'SUBMISSION_MANUAL_COMPLETE_FAILED')
    }
  })

  app.post('/api/bids/:id/submission/cancel', async (request, reply) => {
    if (!requireRole(request, reply, SUBMISSION_EXECUTION_MANAGE_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id } = paramsSchema.parse(request.params)
    const project = await loadOwnedProject(request, reply, supabase, id)
    if (!project) return
    const body = cancelSubmissionRequestSchema.parse(request.body)
    const adminClient = admin(reply)
    if (!adminClient) return
    const store = createSupabaseSubmissionExecutionStore(adminClient)
    try {
      const execution = await cancelSubmission(store, { bidProjectId: id, agencyId: project.agency_id, actorId: request.user!.id, reason: body.reason })
      return { execution }
    } catch (err) {
      handleError(reply, err, 'SUBMISSION_CANCEL_FAILED')
    }
  })
}
