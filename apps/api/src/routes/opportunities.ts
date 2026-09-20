import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { OPPORTUNITY_SCORE_VIEW_ROLES, OPPORTUNITY_SCORE_ACTION_ROLES, OPPORTUNITY_DECISION_SIGNAL } from '@tender-os/constants'
import { requireAuth } from '../middleware/auth.js'
import { requireSupabase } from '../lib/requireSupabase.js'
import { requireRole } from '../lib/requireRole.js'
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js'
import { listQuerySchema } from '../repositories/pagination.js'
import { listOpportunities, listActiveTenderIdsForScan } from '../repositories/opportunities.js'
import { createSupabaseScoringStore } from '../lib/scoring/supabaseScoringStore.js'
import { runScoring, ScoringRunAlreadyActiveError } from '../lib/scoring/runScoring.js'
import { runIntelligencePipelineForTender } from '../lib/ingestion/intelligencePipeline.js'
import { TesseractOcrEngine } from '../lib/documents/ocr/tesseractEngine.js'
import { createOpenAiClient } from '../lib/ai/client.js'
import { loadAiConfig, isAiConfigured } from '../lib/ai/config.js'
import { logger } from '../lib/logger.js'

const listQueryInputSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  decisionSignal: z.enum(OPPORTUNITY_DECISION_SIGNAL).optional(),
})

const scanBodySchema = z.object({
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(50).default(25),
})

/**
 * Bulk backfill batch size is deliberately much smaller than the
 * scoring scan's: unlike runScoring (pure DB round-trips), each
 * tender here can involve real network downloads to external
 * government/SOE sites, OCR, and an OpenAI call — all slow and each
 * individually failure-prone. A small batch keeps one Render request
 * within its timeout and keeps a handful of bad sources from stalling
 * the whole backfill.
 */
const extractBodySchema = z.object({
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(5).default(3),
})

const ocrEngine = new TesseractOcrEngine()

/**
 * The Opportunities view: "scan the currently active tenders and
 * surface intelligence on which ones to bid on", built entirely on
 * the already-existing, already-tested Phase 10 scoring engine
 * (lib/scoring/) — this file adds nothing new to how a tender is
 * scored, only a way to (a) read the resulting intelligence in bulk
 * and (b) trigger the engine across every active tender instead of
 * one at a time from a tender's own detail page.
 *
 * The scan endpoint is deliberately batch-paged rather than "scan
 * everything in one request": `runScoring` does several real
 * Supabase round-trips per tender, and this project's production API
 * (Render free tier) has both a request timeout and a cold-start
 * delay — a single request trying to score every active tender would
 * be slow, unbounded, and would fail the same way for an agency with
 * 50 active tenders as one with 5,000. The frontend calls this
 * repeatedly, advancing `offset`, until `hasMore` is false.
 *
 * POST /api/opportunities/extract is the prerequisite backfill
 * discovered on 2026-09-20: scoring was returning INSUFFICIENT_DATA
 * for every active tender because no tender's documents had ever been
 * downloaded/processed, and no requirement/evaluation-criteria
 * extraction or qualification evaluation had ever run — /scan only
 * *computes a score from* that data, it never produced it. This
 * endpoint runs the document pipeline -> AI extraction ->
 * qualification chain (lib/ingestion/intelligencePipeline.ts) so
 * /scan has real input to work with. Same batch-and-page contract as
 * /scan, just with a smaller batch size (see extractBodySchema).
 */
export async function opportunitiesRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth)

  app.get('/api/opportunities', async (request, reply) => {
    if (!requireRole(request, reply, OPPORTUNITY_SCORE_VIEW_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const query = listQueryInputSchema.parse(request.query)
    const { decisionSignal, ...pagination } = query
    const listQuery = listQuerySchema.parse(pagination)
    return listOpportunities(supabase, listQuery, { decisionSignal })
  })

  app.post('/api/opportunities/scan', async (request, reply) => {
    if (!requireRole(request, reply, OPPORTUNITY_SCORE_ACTION_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
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

    const body = scanBodySchema.parse(request.body ?? {})
    const { ids, total } = await listActiveTenderIdsForScan(supabase, { offset: body.offset, limit: body.limit })

    const store = createSupabaseScoringStore(admin)
    const results: Array<{ tenderId: string; decisionSignal: string | null; overallScore: number | null; reused: boolean; failed: boolean; error?: string }> = []

    for (const tenderId of ids) {
      try {
        const result = await runScoring(store, { tenderId, agencyId, triggeredBy: request.user?.id ?? null })
        results.push({
          tenderId,
          decisionSignal: result.decisionSignal,
          overallScore: result.overallScore,
          reused: result.reused,
          failed: 'failed' in result ? Boolean(result.failed) : false,
        })
      } catch (err) {
        if (err instanceof ScoringRunAlreadyActiveError) {
          results.push({ tenderId, decisionSignal: null, overallScore: null, reused: false, failed: true, error: 'A scoring run is already in progress for this tender.' })
          continue
        }
        const message = err instanceof Error ? err.message : String(err)
        logger.error({ err, tenderId }, 'opportunity scan: scoring run failed for one tender')
        results.push({ tenderId, decisionSignal: null, overallScore: null, reused: false, failed: true, error: message })
      }
    }

    const nextOffset = body.offset + ids.length
    reply.code(200).send({
      processed: ids.length,
      total,
      nextOffset,
      hasMore: nextOffset < total,
      results,
    })
  })

  app.post('/api/opportunities/extract', async (request, reply) => {
    if (!requireRole(request, reply, OPPORTUNITY_SCORE_ACTION_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
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

    const aiConfig = loadAiConfig()
    const ai = isAiConfigured(aiConfig) ? { client: createOpenAiClient(aiConfig.apiKey!), config: aiConfig } : null

    const body = extractBodySchema.parse(request.body ?? {})
    const { ids, total } = await listActiveTenderIdsForScan(supabase, { offset: body.offset, limit: body.limit })

    const results = []
    for (const tenderId of ids) {
      try {
        const result = await runIntelligencePipelineForTender(admin, ocrEngine, ai, tenderId, agencyId)
        results.push(result)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.error({ err, tenderId }, 'opportunity intelligence backfill: pipeline failed unexpectedly for one tender')
        results.push({ tenderId, documents: [], extraction: { skipped: `ERROR: ${message}` }, qualification: { error: message } })
      }
    }

    const nextOffset = body.offset + ids.length
    reply.code(200).send({
      processed: ids.length,
      total,
      nextOffset,
      hasMore: nextOffset < total,
      aiConfigured: ai !== null,
      results,
    })
  })
}
