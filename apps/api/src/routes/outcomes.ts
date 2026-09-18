import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import {
  OUTCOME_MANAGE_ROLES,
  OUTCOME_VERIFY_ROLES,
  MIN_MEANINGFUL_SAMPLE_SIZE,
} from '@tender-os/constants'
import { requireAuth } from '../middleware/auth.js'
import { requireRole } from '../lib/requireRole.js'
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js'
import { createSupabaseOutcomeStore } from '../lib/outcomes/supabaseOutcomeStore.js'
import { reconcileBidResult } from '../lib/outcomes/reconciliation.js'
import { matchWinnerToAgency } from '../lib/outcomes/winnerMatch.js'
import { detectConflict } from '../lib/outcomes/conflicts.js'
import { computeCoreMetrics } from '../lib/outcomes/metrics.js'
import { buildOutcomeFunnel, buildGroupedWinRate, groupedMetricCaveat } from '../lib/outcomes/winLoss.js'
import { computeLearningReadiness } from '../lib/outcomes/learningFeatures.js'
import { evaluateOutcomeFollowUp } from '../lib/outcomes/stateMachine.js'
import type { SubmissionStatusSnapshot } from '@tender-os/constants'
import { createSupabaseNotificationStore } from '../lib/notifications/supabaseNotificationStore.js'
import { buildOutcomeConflictNotification, buildOutcomeDetectedNotification, buildOutcomeRequiresReviewNotification } from '../lib/notifications/build.js'
import { notifyAgenciesForTender } from '../lib/notifications/fanout.js'
import { logOperation } from '../lib/observability/requestLog.js'
import { recordAuditTrailEvent } from '../lib/auditTrail/writer.js'

const idParams = z.object({ id: z.string().uuid() })
const listQuery = z.object({
  tenderId: z.string().uuid().optional(),
  outcomeStatus: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().optional(),
})

/**
 * Phase 17 §68/§69/§70 — outcome + analytics API. Route paths checked
 * against every existing routes/*.ts file first: none of `/outcomes`,
 * `/outcomes/:id`, `/outcomes/:id/verify`, `/outcomes/:id/conflicts`,
 * `/bids/:id/outcome`, `/analytics/outcomes`, `/analytics/win-loss`,
 * `/analytics/competitors`, `/analytics/learning` collide with any
 * route already registered in app.ts, so the spec's §68 paths are used
 * verbatim (mirrors the check documented in routes/submissionExecution.ts).
 *
 * Public procurement facts (tender_outcomes) are readable by any
 * authenticated user (RLS already enforces this at the DB level for
 * direct queries; this service-role-backed API additionally never
 * exposes an agency's internal fields — our_score, notes, internal
 * loss-reason detail — on the shared /api/outcomes endpoints, only on
 * the agency-scoped /api/bids/:id/outcome ones (spec §73).
 */
export async function outcomesRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth)

  function admin(reply: FastifyReply) {
    const client = getSupabaseAdmin()
    if (!client) {
      reply.code(503).send({ error: { code: 'DATABASE_NOT_CONFIGURED', message: 'Supabase is not configured yet.' } })
      return null
    }
    return client
  }

  function agencyOf(request: FastifyRequest, reply: FastifyReply): string | null {
    const agencyId = request.user?.agencyId
    if (!agencyId) {
      reply.code(422).send({ error: { code: 'NO_AGENCY', message: 'Your account is not associated with an agency.' } })
      return null
    }
    return agencyId
  }

  async function writeAudit(
    supabase: ReturnType<typeof getSupabaseAdmin>,
    action: string,
    entityId: string | null,
    agencyId: string | null,
    actorId: string | null,
    oldValue: unknown,
    newValue: unknown,
    entityType = 'tender_outcome',
  ) {
    if (!supabase) return
    await supabase.from('audit_logs').insert({
      agency_id: agencyId,
      actor_id: actorId,
      actor_type: 'USER',
      action,
      entity_type: entityType,
      entity_id: entityId,
      old_value: oldValue ?? null,
      new_value: newValue ?? null,
    })
  }

  // -----------------------------------------------------------------
  // GET /api/outcomes — shared tender-outcome facts, paginated/filterable.
  // -----------------------------------------------------------------
  app.get('/api/outcomes', async (request, reply) => {
    const supabase = admin(reply)
    if (!supabase) return
    const query = listQuery.safeParse(request.query)
    if (!query.success) {
      reply.code(400).send({ error: { code: 'INVALID_QUERY', message: query.error.message } })
      return
    }
    const store = createSupabaseOutcomeStore(supabase)
    const results = await store.listTenderOutcomes({
      tenderId: query.data.tenderId,
      outcomeStatus: query.data.outcomeStatus as never,
      limit: query.data.limit,
    })
    reply.send({ data: results, pagination: { limit: query.data.limit, count: results.length } })
  })

  // -----------------------------------------------------------------
  // GET /api/outcomes/:id
  // -----------------------------------------------------------------
  app.get('/api/outcomes/:id', async (request, reply) => {
    const supabase = admin(reply)
    if (!supabase) return
    const params = idParams.parse(request.params)
    const store = createSupabaseOutcomeStore(supabase)
    const outcome = await store.getTenderOutcome(params.id)
    if (!outcome) {
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Outcome not found.' } })
      return
    }
    const conflicts = await store.listConflicts(params.id)
    reply.send({ data: outcome, conflicts })
  })

  // -----------------------------------------------------------------
  // POST /api/outcomes — record a new (or superseding) tender outcome.
  // Never overwrites history: a superseding record supersedes_id-links
  // the prior one and marks it not-current (spec §59/§60).
  // -----------------------------------------------------------------
  const createOutcomeBody = z.object({
    tenderId: z.string().uuid(),
    outcomeStatus: z.string(),
    publishedDate: z.string().nullable().optional(),
    decisionDate: z.string().nullable().optional(),
    winnerName: z.string().nullable().optional(),
    winnerRegistrationNumber: z.string().nullable().optional(),
    winnerProvince: z.string().nullable().optional(),
    winnerEntityType: z.string().nullable().optional(),
    awardValue: z.number().nonnegative().nullable().optional(),
    awardCurrency: z.string().default('ZAR'),
    contractDuration: z.string().nullable().optional(),
    procurementMethod: z.string().nullable().optional(),
    sourceUrl: z.string().nullable().optional(),
    sourceDocumentId: z.string().uuid().nullable().optional(),
    sourceEvidenceRef: z.string().nullable().optional(),
    provenance: z.string().default('HUMAN_REPORTED'),
    notes: z.string().nullable().optional(),
  })
  app.post('/api/outcomes', async (request, reply) => {
    if (!requireRole(request, reply, OUTCOME_MANAGE_ROLES)) return
    const supabase = admin(reply)
    if (!supabase) return
    const body = createOutcomeBody.safeParse(request.body)
    if (!body.success) {
      reply.code(400).send({ error: { code: 'INVALID_BODY', message: body.error.message } })
      return
    }
    const store = createSupabaseOutcomeStore(supabase)
    const existing = await store.getCurrentTenderOutcomeForTender(body.data.tenderId)
    const opStart = Date.now()

    let conflictCreated = false
    if (existing && existing.winnerName && body.data.winnerName) {
      const conflict = detectConflict({
        fieldName: 'winner_name',
        existingValue: existing.winnerName,
        incomingValue: body.data.winnerName,
        existingAuthorityLevel: null,
        incomingAuthorityLevel: null,
      })
      if (conflict.hasConflict) {
        const createdConflict = await store.createConflict({
          tenderOutcomeId: existing.id,
          fieldName: 'winner_name',
          existingValue: existing.winnerName,
          conflictingValue: body.data.winnerName,
          existingSource: existing.sourceUrl,
          conflictingSource: body.data.sourceUrl ?? null,
          status: 'OPEN',
          resolvedBy: null,
          resolvedAt: null,
          resolutionNotes: null,
        })
        conflictCreated = true
        await writeAudit(supabase, 'OUTCOME_CONFLICT_CREATED', existing.id, null, request.user?.id ?? null, existing, body.data)
        await notifyAgenciesForTender(supabase, body.data.tenderId, (agencyId, bidStrategyProjectId) =>
          buildOutcomeConflictNotification({ agencyId, conflictId: createdConflict.id, tenderOutcomeId: existing.id, tenderId: body.data.tenderId, bidStrategyProjectId, fieldName: 'winner_name' }),
        )
      }
    }

    const created = await store.createTenderOutcome({
      tenderId: body.data.tenderId,
      awardId: null,
      outcomeStatus: body.data.outcomeStatus as never,
      publishedDate: body.data.publishedDate ?? null,
      decisionDate: body.data.decisionDate ?? null,
      winnerName: body.data.winnerName ?? null,
      winnerRegistrationNumber: body.data.winnerRegistrationNumber ?? null,
      winnerProvince: body.data.winnerProvince ?? null,
      winnerEntityType: body.data.winnerEntityType ?? null,
      awardValue: body.data.awardValue ?? null,
      awardCurrency: body.data.awardCurrency,
      contractDuration: body.data.contractDuration ?? null,
      procurementMethod: body.data.procurementMethod ?? null,
      sourceUrl: body.data.sourceUrl ?? null,
      sourceDocumentId: body.data.sourceDocumentId ?? null,
      sourceEvidenceRef: body.data.sourceEvidenceRef ?? null,
      truthStatus: 'UNVERIFIED',
      provenance: body.data.provenance as never,
      recordedBy: request.user?.id ?? null,
      recordedAt: new Date().toISOString(),
      verifiedBy: null,
      verifiedAt: null,
      notes: body.data.notes ?? null,
      isCurrent: true,
      version: existing ? existing.version + 1 : 1,
      supersedesId: existing?.id ?? null,
    })

    await writeAudit(supabase, 'OUTCOME_CREATED', created.id, null, request.user?.id ?? null, existing ?? null, created)
    // Phase 20 §4D — OUTCOME_RECORDED stage, correlated by the tender
    // (an outcome is tender-level, recorded whether or not this
    // agency itself bid on it).
    await recordAuditTrailEvent(supabase, {
      correlationId: body.data.tenderId,
      agencyId: null,
      stage: 'OUTCOME_RECORDED',
      entityType: 'tender_outcomes',
      entityId: created.id,
      actorType: 'USER',
      actorId: request.user?.id ?? null,
      summary: `Tender outcome recorded (${created.outcomeStatus}).`,
    })
    await notifyAgenciesForTender(supabase, body.data.tenderId, (agencyId, bidStrategyProjectId) =>
      buildOutcomeDetectedNotification({ agencyId, tenderOutcomeId: created.id, tenderId: body.data.tenderId, bidStrategyProjectId, outcomeStatus: created.outcomeStatus }),
    )
    logOperation({
      requestId: request.id,
      agencyId: request.user?.agencyId ?? null,
      userId: request.user?.id ?? null,
      entityId: created.id,
      operation: 'outcomes.create',
      status: 'SUCCESS',
      durationMs: Date.now() - opStart,
    })
    reply.code(201).send({ data: created, conflictCreated })
  })

  // -----------------------------------------------------------------
  // PATCH /api/outcomes/:id — only non-fact metadata (notes) — the
  // fact fields themselves are never edited in place; a correction is
  // always a new POST /api/outcomes record (spec §59).
  // -----------------------------------------------------------------
  app.patch('/api/outcomes/:id', async (request, reply) => {
    if (!requireRole(request, reply, OUTCOME_MANAGE_ROLES)) return
    const supabase = admin(reply)
    if (!supabase) return
    const params = idParams.parse(request.params)
    const body = z.object({ notes: z.string().nullable() }).parse(request.body)
    const store = createSupabaseOutcomeStore(supabase)
    const before = await store.getTenderOutcome(params.id)
    const updated = await store.updateTenderOutcome(params.id, { notes: body.notes })
    await writeAudit(supabase, 'OUTCOME_UPDATED', params.id, null, request.user?.id ?? null, before, updated)
    reply.send({ data: updated })
  })

  // -----------------------------------------------------------------
  // POST /api/outcomes/:id/verify — human verification gate (spec §18).
  // -----------------------------------------------------------------
  app.post('/api/outcomes/:id/verify', async (request, reply) => {
    if (!requireRole(request, reply, OUTCOME_VERIFY_ROLES)) return
    const supabase = admin(reply)
    if (!supabase) return
    const params = idParams.parse(request.params)
    const store = createSupabaseOutcomeStore(supabase)
    const before = await store.getTenderOutcome(params.id)
    if (!before) {
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Outcome not found.' } })
      return
    }
    if (!before.sourceUrl && !before.sourceDocumentId && !before.sourceEvidenceRef) {
      reply.code(422).send({ error: { code: 'NO_EVIDENCE', message: 'An outcome cannot be verified without attached evidence (spec §16/§18).' } })
      return
    }
    const verified = await store.verifyTenderOutcome(params.id, request.user!.id, new Date().toISOString())
    await writeAudit(supabase, 'OUTCOME_VERIFIED', params.id, null, request.user?.id ?? null, before, verified)
    reply.send({ data: verified })
  })

  // -----------------------------------------------------------------
  // POST /api/outcomes/:id/conflicts — manually flag a conflict; GET to list.
  // -----------------------------------------------------------------
  const conflictBody = z.object({ fieldName: z.string(), conflictingValue: z.string(), conflictingSource: z.string().nullable().optional() })
  app.post('/api/outcomes/:id/conflicts', async (request, reply) => {
    if (!requireRole(request, reply, OUTCOME_MANAGE_ROLES)) return
    const supabase = admin(reply)
    if (!supabase) return
    const params = idParams.parse(request.params)
    const body = conflictBody.parse(request.body)
    const store = createSupabaseOutcomeStore(supabase)
    const outcome = await store.getTenderOutcome(params.id)
    if (!outcome) {
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Outcome not found.' } })
      return
    }
    const existingValue = (outcome as unknown as Record<string, unknown>)[toCamel(body.fieldName)] as string | null
    const conflict = await store.createConflict({
      tenderOutcomeId: params.id,
      fieldName: body.fieldName,
      existingValue: existingValue ?? null,
      conflictingValue: body.conflictingValue,
      existingSource: outcome.sourceUrl,
      conflictingSource: body.conflictingSource ?? null,
      status: 'OPEN',
      resolvedBy: null,
      resolvedAt: null,
      resolutionNotes: null,
    })
    await writeAudit(supabase, 'OUTCOME_CONFLICT_CREATED', params.id, null, request.user?.id ?? null, null, conflict)
    await notifyAgenciesForTender(supabase, outcome.tenderId, (agencyId, bidStrategyProjectId) =>
      buildOutcomeConflictNotification({ agencyId, conflictId: conflict.id, tenderOutcomeId: params.id, tenderId: outcome.tenderId, bidStrategyProjectId, fieldName: body.fieldName }),
    )
    reply.code(201).send({ data: conflict })
  })

  app.get('/api/outcomes/:id/conflicts', async (request, reply) => {
    const supabase = admin(reply)
    if (!supabase) return
    const params = idParams.parse(request.params)
    const store = createSupabaseOutcomeStore(supabase)
    reply.send({ data: await store.listConflicts(params.id) })
  })

  // -----------------------------------------------------------------
  // GET /api/outcomes/conflicts — cross-outcome conflict list for the
  // conflict-review UI (spec §17/§106 "conflict handling"). Shared
  // catalogue data (outcome_conflicts is select-authenticated), so no
  // agency scoping is applied here.
  // -----------------------------------------------------------------
  app.get('/api/outcomes/conflicts', async (request, reply) => {
    const supabase = admin(reply)
    if (!supabase) return
    const query = z.object({ status: z.enum(['OPEN', 'RESOLVED', 'DISMISSED']).optional(), limit: z.coerce.number().int().min(1).max(100).default(25) }).parse(request.query)
    let q = supabase.from('outcome_conflicts').select('*, tender_outcomes:tender_outcome_id(tender_id, winner_name)').order('discovered_at', { ascending: false }).limit(query.limit)
    if (query.status) q = q.eq('status', query.status)
    const { data } = await q
    reply.send({ data: data ?? [] })
  })

  app.post('/api/outcomes/conflicts/:id/resolve', async (request, reply) => {
    if (!requireRole(request, reply, OUTCOME_VERIFY_ROLES)) return
    const supabase = admin(reply)
    if (!supabase) return
    const params = idParams.parse(request.params)
    const body = z.object({ status: z.enum(['RESOLVED', 'DISMISSED']), notes: z.string().nullable().optional() }).parse(request.body)
    const store = createSupabaseOutcomeStore(supabase)
    const resolved = await store.resolveConflict(params.id, body.status, request.user!.id, new Date().toISOString(), body.notes ?? null)
    await writeAudit(supabase, 'OUTCOME_CONFLICT_RESOLVED', params.id, null, request.user?.id ?? null, null, resolved)
    reply.send({ data: resolved })
  })

  // -----------------------------------------------------------------
  // GET /api/tenders/:id/outcome — the tender-detail outcome tab's data
  // source (public FACT layer + open conflicts). Mirrors the existing
  // /api/tenders/:id/{bid-decision,opportunity-score,qualification}
  // convention checked in every other tenderX.ts route file.
  // -----------------------------------------------------------------
  app.get('/api/tenders/:id/outcome', async (request, reply) => {
    const supabase = admin(reply)
    if (!supabase) return
    const params = idParams.parse(request.params)
    const store = createSupabaseOutcomeStore(supabase)
    const outcome = await store.getCurrentTenderOutcomeForTender(params.id)
    if (!outcome) {
      reply.send({ data: null, conflicts: [] })
      return
    }
    const conflicts = await store.listConflicts(outcome.id)
    reply.send({ data: outcome, conflicts })
  })

  // -----------------------------------------------------------------
  // GET /api/bids/:id/outcome — reconcile + return OUR result for one
  // bid project (agency-scoped, internal fields included — spec §73).
  // -----------------------------------------------------------------
  app.get('/api/bids/:id/outcome', async (request, reply) => {
    const supabase = admin(reply)
    if (!supabase) return
    const agencyId = agencyOf(request, reply)
    if (!agencyId) return
    const params = idParams.parse(request.params)
    const reconcileStart = Date.now()

    const { data: project } = await supabase.from('bid_strategy_projects').select('id, tender_id, agency_id').eq('id', params.id).maybeSingle()
    if (!project || project.agency_id !== agencyId) {
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Bid project not found.' } })
      return
    }

    const store = createSupabaseOutcomeStore(supabase)
    const tenderOutcome = await store.getCurrentTenderOutcomeForTender(project.tender_id as string)
    const { data: execution } = await supabase.from('bid_submission_executions').select('id, status, submitted_at').eq('bid_project_id', params.id).maybeSingle()
    const { data: receipts } = execution
      ? await supabase.from('bid_submission_receipts').select('verification_status').eq('submission_execution_id', execution.id as string)
      : { data: [] as Array<{ verification_status: string }> }

    const submissionStatus: SubmissionStatusSnapshot = deriveSubmissionStatus(execution?.status as string | undefined, (receipts ?? []).some((r) => r.verification_status === 'VERIFIED'))
    const { data: agency } = await supabase.from('agencies').select('name, registration_number').eq('id', agencyId).maybeSingle()
    const { weAreWinner, matchBasis: winnerMatchBasis } = matchWinnerToAgency({
      agencyName: (agency?.name as string) ?? null,
      agencyRegistrationNumber: (agency?.registration_number as string) ?? null,
      winnerName: tenderOutcome?.winnerName ?? null,
      winnerRegistrationNumber: tenderOutcome?.winnerRegistrationNumber ?? null,
    })

    const reconciliation = reconcileBidResult({
      outcomeStatus: tenderOutcome?.outcomeStatus ?? 'UNKNOWN',
      submissionStatus,
      weAreWinner,
      explicitlyWithdrawn: false,
      explicitlyDisqualified: false,
    })

    const existing = await store.getBidOutcome(params.id)
    const bidOutcome = await store.upsertBidOutcome({
      bidProjectId: params.id,
      agencyId,
      tenderId: project.tender_id as string,
      tenderOutcomeId: tenderOutcome?.id ?? null,
      ourResult: reconciliation.ourResult,
      ourRank: existing?.ourRank ?? null,
      ourScore: existing?.ourScore ?? null,
      winningScore: existing?.winningScore ?? null,
      disqualificationReason: existing?.disqualificationReason ?? null,
      submissionStatusSnapshot: submissionStatus,
      reconciliationBasis: reconciliation.basis,
      reconciledAt: new Date().toISOString(),
      truthStatus: reconciliation.ourResult === 'UNKNOWN' ? 'UNKNOWN' : 'INFERRED',
      provenance: 'SYSTEM_CALCULATED',
      recordedBy: request.user?.id ?? null,
      recordedAt: new Date().toISOString(),
      verifiedBy: existing?.verifiedBy ?? null,
      verifiedAt: existing?.verifiedAt ?? null,
      notes: existing?.notes ?? null,
      isCurrent: true,
      version: existing ? existing.version + 1 : 1,
    })

    const lossReasons = await store.listLossReasons(bidOutcome.id)
    const followUp = evaluateOutcomeFollowUp({
      submissionStatus,
      outcomeKnown: bidOutcome.ourResult !== 'UNKNOWN',
      submittedAtIso: (execution?.submitted_at as string) ?? null,
      nowIso: new Date().toISOString(),
    })

    if (bidOutcome.ourResult === 'WON') await writeAudit(supabase, 'WIN_RECORDED', bidOutcome.id, agencyId, request.user?.id ?? null, null, bidOutcome)
    if (bidOutcome.ourResult === 'LOST') await writeAudit(supabase, 'LOSS_RECORDED', bidOutcome.id, agencyId, request.user?.id ?? null, null, bidOutcome)

    // OUTCOME_REQUIRES_REVIEW (spec §15) — the tender has a known,
    // AWARDED outcome yet reconciliation still could not resolve OUR
    // result (e.g. winner not yet matched, or only an unverified
    // submission report exists) — exactly the case a human needs to
    // look at, never auto-resolved (spec §55).
    if (tenderOutcome && tenderOutcome.outcomeStatus === 'AWARDED' && bidOutcome.ourResult === 'UNKNOWN') {
      const notificationStore = createSupabaseNotificationStore(supabase)
      await notificationStore.create(
        buildOutcomeRequiresReviewNotification({
          agencyId,
          bidStrategyProjectId: params.id,
          tenderOutcomeId: tenderOutcome.id,
          tenderId: project.tender_id as string,
          reason: reconciliation.basis,
        }),
      )
    }

    logOperation({
      requestId: request.id,
      agencyId,
      userId: request.user?.id ?? null,
      entityId: bidOutcome.id,
      operation: 'outcomes.reconcile',
      status: 'SUCCESS',
      durationMs: Date.now() - reconcileStart,
    })
    reply.send({ data: bidOutcome, tenderOutcome, lossReasons, followUp, winnerMatchBasis })
  })

  // -----------------------------------------------------------------
  // POST /api/bids/:id/outcome/loss-reasons — record a structured loss reason.
  // -----------------------------------------------------------------
  const lossReasonBody = z.object({ category: z.string(), isPrimary: z.boolean().default(false), provenance: z.string().default('HUMAN_REPORTED'), notes: z.string().nullable().optional(), sourceDocumentId: z.string().uuid().nullable().optional() })
  app.post('/api/bids/:id/outcome/loss-reasons', async (request, reply) => {
    if (!requireRole(request, reply, OUTCOME_MANAGE_ROLES)) return
    const supabase = admin(reply)
    if (!supabase) return
    const agencyId = agencyOf(request, reply)
    if (!agencyId) return
    const params = idParams.parse(request.params)
    const body = lossReasonBody.parse(request.body)
    const store = createSupabaseOutcomeStore(supabase)
    const bidOutcome = await store.getBidOutcome(params.id)
    if (!bidOutcome || bidOutcome.agencyId !== agencyId) {
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Bid outcome not found — compute it via GET /api/bids/:id/outcome first.' } })
      return
    }
    const reason = await store.addLossReason({
      bidOutcomeId: bidOutcome.id,
      agencyId,
      category: body.category as never,
      isPrimary: body.isPrimary,
      provenance: body.provenance as never,
      sourceDocumentId: body.sourceDocumentId ?? null,
      notes: body.notes ?? null,
      recordedBy: request.user?.id ?? null,
    })
    await writeAudit(supabase, 'LOSS_REASON_ADDED', bidOutcome.id, agencyId, request.user?.id ?? null, null, reason)
    reply.code(201).send({ data: reason })
  })

  // -----------------------------------------------------------------
  // GET /api/analytics/outcomes — agency-scoped core metrics (spec §27-§29/§49).
  // -----------------------------------------------------------------
  app.get('/api/analytics/outcomes', async (request, reply) => {
    const supabase = admin(reply)
    if (!supabase) return
    const agencyId = agencyOf(request, reply)
    if (!agencyId) return

    const { data: outcomes } = await supabase.from('bid_outcomes').select('our_result').eq('agency_id', agencyId).eq('is_current', true)
    const { count: totalProjects } = await supabase.from('bid_strategy_projects').select('id', { count: 'exact', head: true }).eq('agency_id', agencyId)
    const { count: totalDecisions } = await supabase.from('bid_decision_runs').select('id', { count: 'exact', head: true }).eq('agency_id', agencyId).eq('is_current', true).in('final_decision', ['BID', 'PRIORITY_BID', 'CONDITIONAL'])

    const rows = outcomes ?? []
    const counts = {
      totalOpportunities: totalProjects ?? 0,
      totalQualified: totalProjects ?? 0,
      totalBidDecisions: totalDecisions ?? 0,
      totalEligibleForSubmission: totalDecisions ?? 0,
      submittedVerified: rows.filter((r) => r.our_result !== 'NOT_SUBMITTED' && r.our_result !== 'UNKNOWN').length,
      submittedReported: 0,
      notSubmitted: rows.filter((r) => r.our_result === 'NOT_SUBMITTED').length,
      won: rows.filter((r) => r.our_result === 'WON').length,
      lost: rows.filter((r) => r.our_result === 'LOST').length,
      disqualified: rows.filter((r) => r.our_result === 'DISQUALIFIED').length,
      withdrawn: rows.filter((r) => r.our_result === 'WITHDRAWN').length,
      outcomeUnknown: rows.filter((r) => r.our_result === 'UNKNOWN').length,
      noAward: 0,
      cancelled: 0,
    }

    const metrics = computeCoreMetrics(counts)
    const funnel = buildOutcomeFunnel({
      opportunities: counts.totalOpportunities,
      qualified: counts.totalQualified,
      bid: counts.totalBidDecisions,
      submitted: counts.submittedVerified,
      outcomeKnown: counts.won + counts.lost + counts.disqualified,
      won: counts.won,
    })

    reply.send({ data: { counts, metrics, funnel, generatedAt: new Date().toISOString() } })
  })

  // -----------------------------------------------------------------
  // GET /api/analytics/win-loss — grouped win-rate table (spec §30/§31/§51).
  // -----------------------------------------------------------------
  const winLossQuery = z.object({
    result: z.string().optional(),
    category: z.string().optional(),
    province: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  })
  app.get('/api/analytics/win-loss', async (request, reply) => {
    const supabase = admin(reply)
    if (!supabase) return
    const agencyId = agencyOf(request, reply)
    if (!agencyId) return
    const filters = winLossQuery.safeParse(request.query)
    if (!filters.success) {
      reply.code(400).send({ error: { code: 'INVALID_QUERY', message: filters.error.message } })
      return
    }

    const { data: outcomes } = await supabase
      .from('bid_outcomes')
      .select(
        'id, our_result, tender_id, tender_outcome_id, reconciliation_basis, tenders:tender_id(title, category, organisation, province), tender_outcomes:tender_outcome_id(winner_name, award_value)',
      )
      .eq('agency_id', agencyId)
      .eq('is_current', true)
      .limit(filters.data.limit)

    type TableRow = {
      id: string
      tenderId: string
      tenderTitle: string | null
      organisation: string | null
      category: string | null
      province: string | null
      ourResult: string
      winnerName: string | null
      awardValue: number | null
    }
    const groups: Record<string, { won: number; verifiedSubmitted: number }> = {}
    const tableRows: TableRow[] = []
    for (const row of outcomes ?? []) {
      const tender = (row as unknown as { tenders: { title: string | null; category: string | null; organisation: string | null; province: string | null } | null }).tenders
      const outcome = (row as unknown as { tender_outcomes: { winner_name: string | null; award_value: number | null } | null }).tender_outcomes
      const key = tender?.category ?? 'Uncategorised'
      groups[key] = groups[key] ?? { won: 0, verifiedSubmitted: 0 }
      if (row.our_result !== 'NOT_SUBMITTED' && row.our_result !== 'UNKNOWN') groups[key].verifiedSubmitted += 1
      if (row.our_result === 'WON') groups[key].won += 1

      if (filters.data.result && row.our_result !== filters.data.result) continue
      if (filters.data.category && tender?.category !== filters.data.category) continue
      if (filters.data.province && tender?.province !== filters.data.province) continue
      tableRows.push({
        id: row.id as string,
        tenderId: row.tender_id as string,
        tenderTitle: tender?.title ?? null,
        organisation: tender?.organisation ?? null,
        category: tender?.category ?? null,
        province: tender?.province ?? null,
        ourResult: row.our_result as string,
        winnerName: outcome?.winner_name ?? null,
        awardValue: outcome?.award_value ?? null,
      })
    }
    const grouped = buildGroupedWinRate(groups).map((row) => ({ ...row, caveat: groupedMetricCaveat(row) }))

    reply.send({ data: { byCategory: grouped, rows: tableRows, minMeaningfulSampleSize: MIN_MEANINGFUL_SAMPLE_SIZE } })
  })

  // -----------------------------------------------------------------
  // GET /api/analytics/competitors (spec §64/§65/§90). Paginated
  // (page/pageSize, matching the tenders.ts convention) and filterable
  // by name search, the competitor's own recorded province, and by
  // category — a competitor is matched to a category by having at
  // least one competitor_activity row against a tender in that
  // category (province filters the competitor's own `province` field
  // directly; category necessarily looks through competitor_activity
  // since tenders/category is not a field on competitors itself).
  // -----------------------------------------------------------------
  const competitorListQuery = z.object({
    search: z.string().trim().min(1).max(200).optional(),
    province: z.string().optional(),
    category: z.string().optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  app.get('/api/analytics/competitors', async (request, reply) => {
    const supabase = admin(reply)
    if (!supabase) return
    const query = competitorListQuery.safeParse(request.query)
    if (!query.success) {
      reply.code(400).send({ error: { code: 'INVALID_QUERY', message: query.error.message } })
      return
    }
    const { search, province, category, page, pageSize } = query.data
    const offset = (page - 1) * pageSize

    // A category filter narrows to competitors observed in at least
    // one tender of that category, via competitor_activity — resolved
    // first so it can be applied as an `in (...)` filter alongside the
    // rest, rather than fetched, then filtered in memory (spec §97:
    // aggregation stays server-side, never client-side).
    let categoryCompetitorIds: string[] | null = null
    if (category) {
      const { data: tendersInCategory } = await supabase.from('tenders').select('id').eq('category', category)
      const tenderIds = (tendersInCategory ?? []).map((t) => t.id as string)
      if (tenderIds.length === 0) {
        reply.send({ data: [], page, pageSize, total: 0, totalPages: 0 })
        return
      }
      const { data: activityInCategory } = await supabase.from('competitor_activity').select('competitor_id').in('tender_id', tenderIds)
      categoryCompetitorIds = Array.from(new Set((activityInCategory ?? []).map((a) => a.competitor_id as string)))
      if (categoryCompetitorIds.length === 0) {
        reply.send({ data: [], page, pageSize, total: 0, totalPages: 0 })
        return
      }
    }

    let listQ = supabase.from('competitors').select('id, name, data_quality, province, registration_number', { count: 'exact' })
    if (search) listQ = listQ.ilike('name', `%${search}%`)
    if (province) listQ = listQ.eq('province', province)
    if (categoryCompetitorIds) listQ = listQ.in('id', categoryCompetitorIds)
    listQ = listQ.order('name', { ascending: true }).range(offset, offset + pageSize - 1)

    const { data: competitors, count } = await listQ
    const competitorIds = (competitors ?? []).map((c) => c.id as string)
    const { data: activity } = competitorIds.length
      ? await supabase.from('competitor_activity').select('competitor_id, result').in('competitor_id', competitorIds)
      : { data: [] as Array<{ competitor_id: string; result: string }> }

    const results = (competitors ?? []).map((c) => {
      const mine = (activity ?? []).filter((a) => a.competitor_id === c.id)
      return {
        competitorId: c.id,
        name: c.name,
        dataQuality: c.data_quality,
        province: c.province,
        hasRegistrationNumber: c.registration_number !== null,
        bidderCount: mine.filter((a) => a.result === 'BIDDER').length,
        winnerCount: mine.filter((a) => a.result === 'WINNER').length,
        shortlistedCount: mine.filter((a) => a.result === 'SHORTLISTED').length,
        disqualifiedCount: mine.filter((a) => a.result === 'DISQUALIFIED').length,
        recordedBids: mine.length,
        verifiedWins: mine.filter((a) => a.result === 'WINNER').length,
      }
    })
    const total = count ?? results.length
    reply.send({ data: results, page, pageSize, total, totalPages: Math.ceil(total / pageSize) })
  })

  // -----------------------------------------------------------------
  // POST /api/analytics/competitors — record/update a competitor
  // (spec §11/§65: never auto-created from an unverified AI/scraped
  // mention — this is the explicit, human/managed-write path). Never
  // fabricates registration data — unknown fields stay null.
  // -----------------------------------------------------------------
  const competitorBody = z.object({
    name: z.string().min(1),
    registrationNumber: z.string().nullable().optional(),
    website: z.string().nullable().optional(),
    province: z.string().nullable().optional(),
    entityType: z.string().nullable().optional(),
    dataQuality: z.enum(['OBSERVED', 'VERIFIED', 'INFERRED', 'UNKNOWN']).default('OBSERVED'),
  })
  app.post('/api/analytics/competitors', async (request, reply) => {
    if (!requireRole(request, reply, OUTCOME_MANAGE_ROLES)) return
    const supabase = admin(reply)
    if (!supabase) return
    const body = competitorBody.safeParse(request.body)
    if (!body.success) {
      reply.code(400).send({ error: { code: 'INVALID_BODY', message: body.error.message } })
      return
    }
    const normalizedName = body.data.name.trim().toLowerCase()
    const { data: existing } = await supabase.from('competitors').select('id').eq('normalized_name', normalizedName).maybeSingle()

    let competitor
    if (existing) {
      const { data, error } = await supabase
        .from('competitors')
        .update({
          registration_number: body.data.registrationNumber ?? null,
          website: body.data.website ?? null,
          province: body.data.province ?? null,
          entity_type: body.data.entityType ?? null,
          data_quality: body.data.dataQuality,
          last_seen_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select('*')
        .single()
      if (error || !data) {
        reply.code(500).send({ error: { code: 'COMPETITOR_UPDATE_FAILED', message: error?.message ?? 'Failed to update competitor.' } })
        return
      }
      competitor = data
    } else {
      const { data, error } = await supabase
        .from('competitors')
        .insert({
          name: body.data.name,
          normalized_name: normalizedName,
          registration_number: body.data.registrationNumber ?? null,
          website: body.data.website ?? null,
          province: body.data.province ?? null,
          entity_type: body.data.entityType ?? null,
          data_quality: body.data.dataQuality,
        })
        .select('*')
        .single()
      if (error || !data) {
        reply.code(500).send({ error: { code: 'COMPETITOR_CREATE_FAILED', message: error?.message ?? 'Failed to create competitor.' } })
        return
      }
      competitor = data
    }

    await writeAudit(supabase, 'COMPETITOR_RECORDED', competitor.id as string, null, request.user?.id ?? null, existing ?? null, competitor, 'competitor')
    reply.code(existing ? 200 : 201).send({ data: competitor })
  })

  // -----------------------------------------------------------------
  // GET /api/analytics/learning (spec §43/§81/§82).
  // -----------------------------------------------------------------
  app.get('/api/analytics/learning', async (request, reply) => {
    const supabase = admin(reply)
    if (!supabase) return
    const agencyId = agencyOf(request, reply)
    if (!agencyId) return

    const { count: totalBids } = await supabase.from('bid_strategy_projects').select('id', { count: 'exact', head: true }).eq('agency_id', agencyId)
    const { count: verifiedSubmissions } = await supabase.from('bid_submission_receipts').select('id', { count: 'exact', head: true }).eq('agency_id', agencyId).eq('verification_status', 'VERIFIED')
    const { count: verifiedOutcomes } = await supabase.from('bid_outcomes').select('id', { count: 'exact', head: true }).eq('agency_id', agencyId).eq('truth_status', 'VERIFIED')
    const { count: completeSnapshots } = await supabase.from('outcome_decision_time_features').select('id', { count: 'exact', head: true }).eq('agency_id', agencyId)

    const readiness = computeLearningReadiness({
      totalBids: totalBids ?? 0,
      verifiedSubmissions: verifiedSubmissions ?? 0,
      verifiedOutcomes: verifiedOutcomes ?? 0,
      completeFeatureSnapshots: completeSnapshots ?? 0,
    })

    reply.send({ data: readiness })
  })
}

function deriveSubmissionStatus(executionStatus: string | undefined, hasVerifiedReceipt: boolean): SubmissionStatusSnapshot {
  if (hasVerifiedReceipt || executionStatus === 'SUBMITTED') return 'VERIFIED_SUBMITTED'
  if (executionStatus === 'SUBMISSION_REPORTED') return 'SUBMISSION_REPORTED'
  if (!executionStatus || executionStatus === 'NOT_READY' || executionStatus === 'READY_FOR_SUBMISSION') return 'NOT_SUBMITTED'
  return 'UNKNOWN'
}

function toCamel(snake: string): string {
  return snake.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
}
