import type { FastifyInstance } from 'fastify'
import { BENCHMARK_VIEW_ROLES, BENCHMARK_MANAGE_ROLES } from '@tender-os/constants'
import { benchmarkQuerySchema } from '@tender-os/schemas'
import { requireAuth } from '../middleware/auth.js'
import { requireRole } from '../lib/requireRole.js'
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js'
import { recomputeIndustryBenchmarks, listIndustryBenchmarks } from '../lib/benchmarks/supabaseBenchmarksStore.js'
import { logger } from '../lib/logger.js'

/**
 * Phase 20 §4C — Anonymized Industry Benchmark Intelligence API,
 * backing the dedicated `/intelligence/benchmarks` view. Route paths
 * checked against every other route file first: `/api/intelligence/benchmarks*`
 * does not collide with anything routes/intelligence.ts already
 * registers (that file owns `/api/intelligence/{dataset,model,...}`,
 * never `/benchmarks`).
 *
 * Every response here is fully anonymized and never agency-scoped —
 * unlike almost every other route in this codebase, there is
 * deliberately no per-agency filtering applied, because the whole
 * point of a benchmark is that it is the same answer for every
 * agency. The k-anonymity floor (spec §3: >= 5 distinct entities) is
 * enforced two layers deep: in `lib/benchmarks/aggregate.ts` (pure)
 * when the row is computed, and again by the DB CHECK constraint
 * `industry_benchmarks_daily_k_anonymity` when it is written.
 */
export async function benchmarksRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth)

  app.get('/api/intelligence/benchmarks', async (request, reply) => {
    if (!requireRole(request, reply, BENCHMARK_VIEW_ROLES)) return
    const client = getSupabaseAdmin()
    if (!client) {
      reply.code(503).send({ error: { code: 'DATABASE_NOT_CONFIGURED', message: 'Supabase is not configured yet.' } })
      return
    }
    const filter = benchmarkQuerySchema.parse(request.query)
    const data = await listIndustryBenchmarks(client, filter)
    return { data }
  })

  app.post('/api/intelligence/benchmarks/recompute', async (request, reply) => {
    if (!requireRole(request, reply, BENCHMARK_MANAGE_ROLES)) return
    const client = getSupabaseAdmin()
    if (!client) {
      reply.code(503).send({ error: { code: 'DATABASE_NOT_CONFIGURED', message: 'Supabase is not configured yet.' } })
      return
    }
    const data = await recomputeIndustryBenchmarks(client)
    await client.from('audit_logs').insert({
      agency_id: null,
      actor_id: request.user?.id ?? null,
      actor_type: 'USER',
      action: 'BENCHMARK_RECOMPUTED',
      entity_type: 'industry_benchmarks_daily',
      entity_id: null,
      new_value: { rowsWritten: data.length },
    })
    logger.info({ rowsWritten: data.length }, 'industry benchmarks recomputed')
    return { data }
  })
}
