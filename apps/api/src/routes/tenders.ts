import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth.js'
import { requireSupabase } from '../lib/requireSupabase.js'
import { TENDER_STATUS, BID_DECISION } from '@tender-os/constants'
import { listTenders, getTenderById, TENDER_SORT_COLUMNS } from '../repositories/tenders.js'
import { getTenderSummary } from '../repositories/tenderSummary.js'
import { listTenderDocuments } from '../repositories/tenderDocuments.js'
import { listTenderAddenda } from '../repositories/tenderAddenda.js'
import { listTenderBriefings } from '../repositories/tenderBriefings.js'
import { getCurrentTenderScore } from '../repositories/tenderScores.js'
import { listTenderRisks } from '../repositories/tenderRisks.js'
import { listTenderActivity } from '../repositories/tenderActivity.js'

const idParamsSchema = z.object({ id: z.string().uuid() })

/**
 * GET /api/tenders query parameters (Phase 3 §20). `page`/`pageSize`
 * are the client-facing pagination shape; they're converted to the
 * repository's `limit`/`offset` shape internally. `sort` is validated
 * against the allow-list in repositories/tenders.ts — an unlisted
 * value is a 400, never passed through to the query builder.
 */
export const tenderListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().min(1).max(200).optional(),
  status: z.enum(TENDER_STATUS).optional(),
  service: z.string().uuid().optional(),
  province: z.string().optional(),
  municipality: z.string().optional(),
  entityType: z.string().optional(),
  // Deliberately not z.coerce.boolean(): Zod's coercion is
  // `Boolean(value)`, which treats the literal string "false" as
  // truthy (any non-empty string is). A query param is always a
  // string, so that coercion would silently turn
  // `?briefingRequired=false` into `true`.
  briefingRequired: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
  closingBefore: z.string().date().optional(),
  closingAfter: z.string().date().optional(),
  scoreClass: z.enum(BID_DECISION).optional(),
  source: z.string().uuid().optional(),
  sort: z.enum(TENDER_SORT_COLUMNS).optional(),
  order: z.enum(['asc', 'desc']).optional(),
})

/**
 * The `tenders` resource and everything scoped to one tender (Phase 3
 * §19). Every sub-resource route is a thin pass-through to its own
 * read-only repository — no aggregation, matching, or scoring logic
 * lives in this file.
 */
export async function tendersRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth)

  app.get('/api/tenders/summary', async (request, reply) => {
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    return getTenderSummary(supabase, request.user?.agencyId ?? null)
  })

  app.get('/api/tenders', async (request, reply) => {
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const q = tenderListQuerySchema.parse(request.query)
    const pageSize = q.pageSize
    const offset = (q.page - 1) * pageSize

    const result = await listTenders(
      supabase,
      { limit: pageSize, offset },
      {
        search: q.search,
        status: q.status,
        province: q.province,
        municipality: q.municipality,
        entityType: q.entityType,
        briefingRequired: q.briefingRequired,
        closingBefore: q.closingBefore,
        closingAfter: q.closingAfter,
        serviceId: q.service,
        scoreClass: q.scoreClass,
        sourceId: q.source,
        sort: q.sort,
        order: q.order,
      },
    )

    return {
      rows: result.rows,
      page: q.page,
      pageSize,
      total: result.total ?? null,
      totalPages: result.total !== undefined ? Math.ceil(result.total / pageSize) : null,
    }
  })

  app.get('/api/tenders/:id', async (request, reply) => {
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id } = idParamsSchema.parse(request.params)
    const row = await getTenderById(supabase, id)
    if (!row) {
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Tender not found.' } })
      return
    }
    return row
  })

  // GET /api/tenders/:id/requirements and GET /api/tenders/:id/evaluation
  // were originally registered here (Phase 2, raw `{ rows }` catalogue
  // reads with no role gate). Phase 9 (routes/tenderRequirementsEvaluation.ts)
  // supersedes both with role-gated, fully provenance-linked DTOs at the
  // exact same paths — consolidated there rather than duplicated here
  // (docs/DECISIONS.md, Phase 9 entry). repositories/tenderRequirements.ts
  // and repositories/tenderEvaluationCriteria.ts remain as their own
  // independently-tested read helpers, just no longer routed from here.

  app.get('/api/tenders/:id/documents', async (request, reply) => {
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id } = idParamsSchema.parse(request.params)
    return { rows: await listTenderDocuments(supabase, id) }
  })

  app.get('/api/tenders/:id/addenda', async (request, reply) => {
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id } = idParamsSchema.parse(request.params)
    return { rows: await listTenderAddenda(supabase, id) }
  })

  app.get('/api/tenders/:id/briefing', async (request, reply) => {
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id } = idParamsSchema.parse(request.params)
    return { rows: await listTenderBriefings(supabase, id) }
  })

  app.get('/api/tenders/:id/score', async (request, reply) => {
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id } = idParamsSchema.parse(request.params)
    const score = await getCurrentTenderScore(supabase, id)
    return { score }
  })

  app.get('/api/tenders/:id/risks', async (request, reply) => {
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id } = idParamsSchema.parse(request.params)
    return { rows: await listTenderRisks(supabase, id) }
  })

  app.get('/api/tenders/:id/activity', async (request, reply) => {
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id } = idParamsSchema.parse(request.params)
    return { rows: await listTenderActivity(supabase, id) }
  })
}
