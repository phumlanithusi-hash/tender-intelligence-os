import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { SURVEILLANCE_VIEW_ROLES, SURVEILLANCE_MANAGE_ROLES } from '@tender-os/constants'
import { requireAuth } from '../middleware/auth.js'
import { requireRole } from '../lib/requireRole.js'
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js'
import { selectSourcesDueForPoll, parsePostgresIntervalToMinutes } from '../lib/surveillance/schedule.js'
import { createSupabaseIngestionStore } from '../lib/ingestion/supabaseIngestionStore.js'
import { runEtendersScan } from '../lib/ingestion/scanRunner.js'
import { getAdapter } from '../lib/adapters/registry.js'
import { logger } from '../lib/logger.js'

const sourceParams = z.object({ sourceId: z.string().uuid() })

/**
 * Phase 20 §4A — the continuous surveillance / polling schedule seam.
 * Route paths checked first against every other route file: nothing
 * else registers `/api/surveillance/*`.
 *
 * This codebase has no BullMQ/Redis wiring (re-verified this phase —
 * see docs/DECISIONS.md). `GET /api/surveillance/poll-schedule` is a
 * pure read of which sources a real scheduler WOULD poll right now
 * (`lib/surveillance/schedule.ts`); `POST /api/surveillance/scan/:sourceId`
 * is the same on-demand seam pattern already used by
 * `POST /api/data-quality/scan` and `POST /api/notifications/check` —
 * a real future queue would call the exact same underlying
 * `runEtendersScan` this endpoint calls, only the trigger changes.
 *
 * Honesty boundary (spec §2 binding constraint): this only ever runs
 * a scan for a source whose registered adapter is real — the only
 * one registered today is eTenders, kept at `adapter_state =
 * 'CONFIGURED'` (never `ACTIVE`) specifically because this sandbox's
 * egress proxy blocks etenders.gov.za (docs/DECISIONS.md, Phase 5).
 * `selectSourcesDueForPoll` therefore always reports it as not due —
 * this is the honest, correct answer in this environment, never
 * "live polling succeeded."
 */
export async function surveillanceRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth)

  app.get('/api/surveillance/poll-schedule', async (request, reply) => {
    if (!requireRole(request, reply, SURVEILLANCE_VIEW_ROLES)) return
    const client = getSupabaseAdmin()
    if (!client) {
      reply.code(503).send({ error: { code: 'DATABASE_NOT_CONFIGURED', message: 'Supabase is not configured yet.' } })
      return
    }
    const { data: sources, error } = await client.from('tender_sources').select('id, name, scan_frequency, last_scan_at, adapter_state, adapter_key')
    if (error) {
      reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Could not list sources.' } })
      return
    }
    const pollable = (sources ?? []).map((s) => ({
      id: s.id as string,
      scanFrequencyMinutes: parsePostgresIntervalToMinutes(s.scan_frequency as string | number | null),
      lastScanAt: s.last_scan_at as string | null,
      adapterState: s.adapter_state as string,
    }))
    const results = selectSourcesDueForPoll(pollable, new Date().toISOString())
    const byId = new Map((sources ?? []).map((s) => [s.id as string, s]))
    return {
      data: results.map((r) => ({ ...r, name: (byId.get(r.sourceId)?.name as string | undefined) ?? null, adapterKey: (byId.get(r.sourceId)?.adapter_key as string | undefined) ?? null })),
    }
  })

  app.post('/api/surveillance/scan/:sourceId', async (request, reply) => {
    if (!requireRole(request, reply, SURVEILLANCE_MANAGE_ROLES)) return
    const client = getSupabaseAdmin()
    if (!client) {
      reply.code(503).send({ error: { code: 'DATABASE_NOT_CONFIGURED', message: 'Supabase is not configured yet.' } })
      return
    }
    const { sourceId } = sourceParams.parse(request.params)
    const { data: source } = await client.from('tender_sources').select('id, adapter_key, adapter_state').eq('id', sourceId).maybeSingle()
    if (!source) {
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Source not found.' } })
      return
    }
    if (source.adapter_state !== 'ACTIVE') {
      reply.code(422).send({
        error: {
          code: 'UNAVAILABLE_IN_ENVIRONMENT',
          message: `Source ${sourceId} is ${source.adapter_state}, not ACTIVE — this environment's egress proxy blocks live external portal access, so no adapter is activated here. This endpoint is a real, tested seam a future ACTIVE deployment (or a queue worker) would call on the same schedule reported by GET /api/surveillance/poll-schedule.`,
        },
      })
      return
    }
    const adapter = getAdapter(source.adapter_key as string | null)
    if (!adapter) {
      reply.code(422).send({ error: { code: 'NO_ADAPTER_REGISTERED', message: `No adapter is registered for key "${source.adapter_key}".` } })
      return
    }
    const store = createSupabaseIngestionStore(client)
    const result = await runEtendersScan(store, adapter, { sourceId, executionId: request.id })
    await client.from('audit_logs').insert({
      agency_id: null,
      actor_id: request.user?.id ?? null,
      actor_type: 'USER',
      action: 'SURVEILLANCE_SCAN_RUN',
      entity_type: 'tender_source_scans',
      entity_id: result.scanId,
      new_value: result,
    })
    logger.info({ sourceId, result }, 'on-demand surveillance scan run')
    return { data: result }
  })
}
