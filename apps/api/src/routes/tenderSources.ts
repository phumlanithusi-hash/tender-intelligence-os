import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { TenderSourceRow } from '@tender-os/schemas'
import { requireAuth } from '../middleware/auth.js'
import { requireSupabase } from '../lib/requireSupabase.js'
import { requireRole } from '../lib/requireRole.js'
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js'
import { listQuerySchema } from '../repositories/pagination.js'
import {
  listTenderSources,
  getTenderSourceById,
  updateTenderSourceState,
} from '../repositories/tenderSources.js'
import { listTenderSourceScans, countConsecutiveFailedScans } from '../repositories/tenderSourceScans.js'
import { listTenderSourceErrors } from '../repositories/tenderSourceErrors.js'
import { getTenderSourceSummary } from '../repositories/tenderSourceSummary.js'
import { getAdapter } from '../lib/adapters/registry.js'
import { computeSourceHealth, computeNextScheduledScanAt } from '../lib/sourceHealth.js'

const idParamsSchema = z.object({ id: z.string().uuid() })
const listQueryInputSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
})

/** Roles allowed to view the Source Registry's operational data (Phase 4 §18). */
const VIEW_ROLES = ['ADMIN', 'BID_MANAGER', 'RESEARCHER'] as const
/** Roles allowed to change a source's configuration or run a health check (Phase 4 §18: "Only appropriate roles should modify source configuration"). */
const ADMIN_ROLES = ['ADMIN'] as const

function withSchedule(source: TenderSourceRow) {
  return {
    ...source,
    nextScheduledScanAt: computeNextScheduledScanAt({
      hasAdapter: getAdapter(source.adapter_key) !== null,
      active: source.active,
      adapterState: source.adapter_state,
      lastScanAt: source.last_scan_at,
      scanFrequency: source.scan_frequency,
    }),
  }
}

/**
 * The Source Registry's own resource and its operational sub-
 * resources (Phase 4 §19). Read endpoints are available to any
 * authenticated caller whose role is in VIEW_ROLES (Phase 4 §18) —
 * `tender_sources`'s own RLS already permits any authenticated read,
 * so this is an additional, stricter application-layer check, not a
 * relaxation of RLS. Every mutating endpoint requires ADMIN and goes
 * through the privileged service-role client (never the caller's own
 * RLS-scoped client — see repositories/tenderSources.ts's doc
 * comment).
 */
export async function tenderSourcesRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth)

  app.get('/api/tender-sources/summary', async (request, reply) => {
    if (!requireRole(request, reply, VIEW_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    return getTenderSourceSummary(supabase)
  })

  app.get('/api/tender-sources', async (request, reply) => {
    if (!requireRole(request, reply, VIEW_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const query = listQuerySchema.parse(listQueryInputSchema.parse(request.query))
    const result = await listTenderSources(supabase, query)
    return { ...result, rows: result.rows.map(withSchedule) }
  })

  app.get('/api/tender-sources/:id', async (request, reply) => {
    if (!requireRole(request, reply, VIEW_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id } = idParamsSchema.parse(request.params)
    const row = await getTenderSourceById(supabase, id)
    if (!row) {
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Tender source not found.' } })
      return
    }
    return withSchedule(row)
  })

  app.get('/api/tender-sources/:id/scans', async (request, reply) => {
    if (!requireRole(request, reply, VIEW_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id } = idParamsSchema.parse(request.params)
    const query = listQuerySchema.parse(listQueryInputSchema.parse(request.query))
    return listTenderSourceScans(supabase, id, query)
  })

  app.get('/api/tender-sources/:id/errors', async (request, reply) => {
    if (!requireRole(request, reply, VIEW_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id } = idParamsSchema.parse(request.params)
    const query = listQuerySchema.parse(listQueryInputSchema.parse(request.query))
    return listTenderSourceErrors(supabase, id, query)
  })

  /**
   * Health check (Phase 4 §20): NEVER a scrape. For a source with no
   * registered adapter (every seeded Phase 4 source), this returns
   * NOT_IMPLEMENTED honestly and writes nothing — there is nothing
   * real to record. Only once an adapter is actually registered
   * (Phase 5+) does this call it and persist a real result.
   */
  app.post('/api/tender-sources/:id/health-check', async (request, reply) => {
    if (!requireRole(request, reply, ADMIN_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id } = idParamsSchema.parse(request.params)
    const source = await getTenderSourceById(supabase, id)
    if (!source) {
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Tender source not found.' } })
      return
    }

    const checkedAt = new Date().toISOString()
    const adapter = getAdapter(source.adapter_key)

    if (!adapter) {
      return {
        sourceId: id,
        status: 'DISABLED',
        adapterState: 'NOT_IMPLEMENTED',
        message: 'No adapter is implemented for this source yet — NOT CONNECTED.',
        checkedAt,
      }
    }

    const admin = getSupabaseAdmin()
    if (!admin) {
      reply.code(503).send({
        error: { code: 'DATABASE_NOT_CONFIGURED', message: 'Supabase is not configured yet.' },
      })
      return
    }

    let result: Awaited<ReturnType<typeof adapter.healthCheck>>
    try {
      result = await adapter.healthCheck()
    } catch (err) {
      result = {
        status: 'FAILED',
        message: err instanceof Error ? err.message : 'Health check threw an unexpected error.',
        checkedAt,
      }
    }

    const consecutiveFailedScans = await countConsecutiveFailedScans(supabase, id)
    const computedHealth = computeSourceHealth({
      hasAdapter: true,
      active: source.active,
      adapterState: source.adapter_state,
      consecutiveFailedScans,
    })
    // A FAILED live health check overrides an otherwise-healthy scan
    // history immediately — reachability is checked right now, scan
    // history reflects the past.
    const finalHealth = result.status === 'FAILED' ? 'FAILED' : computedHealth

    await updateTenderSourceState(admin, id, {
      healthStatus: finalHealth,
      lastSuccessAt: result.status !== 'FAILED' ? checkedAt : undefined,
      lastFailureAt: result.status === 'FAILED' ? checkedAt : undefined,
    })

    return {
      sourceId: id,
      status: finalHealth,
      adapterState: source.adapter_state,
      message: result.message,
      checkedAt,
    }
  })

  app.post('/api/tender-sources/:id/enable', async (request, reply) => {
    if (!requireRole(request, reply, ADMIN_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const admin = getSupabaseAdmin()
    if (!admin) {
      reply.code(503).send({ error: { code: 'DATABASE_NOT_CONFIGURED', message: 'Supabase is not configured yet.' } })
      return
    }
    const { id } = idParamsSchema.parse(request.params)
    const source = await getTenderSourceById(supabase, id)
    if (!source) {
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Tender source not found.' } })
      return
    }
    const adapter = getAdapter(source.adapter_key)
    if (!adapter) {
      reply.code(409).send({
        error: {
          code: 'NO_ADAPTER',
          message: 'This source has no implemented adapter yet, so it cannot be enabled (it is NOT CONNECTED).',
        },
      })
      return
    }

    const consecutiveFailedScans = await countConsecutiveFailedScans(supabase, id)
    const healthStatus = computeSourceHealth({
      hasAdapter: true,
      active: true,
      adapterState: 'ACTIVE',
      consecutiveFailedScans,
    })
    return updateTenderSourceState(admin, id, { active: true, adapterState: 'ACTIVE', pausedAt: null, healthStatus })
  })

  app.post('/api/tender-sources/:id/disable', async (request, reply) => {
    if (!requireRole(request, reply, ADMIN_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const admin = getSupabaseAdmin()
    if (!admin) {
      reply.code(503).send({ error: { code: 'DATABASE_NOT_CONFIGURED', message: 'Supabase is not configured yet.' } })
      return
    }
    const { id } = idParamsSchema.parse(request.params)
    const source = await getTenderSourceById(supabase, id)
    if (!source) {
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Tender source not found.' } })
      return
    }
    return updateTenderSourceState(admin, id, {
      active: false,
      adapterState: 'DISABLED',
      pausedAt: null,
      healthStatus: 'DISABLED',
    })
  })

  app.post('/api/tender-sources/:id/pause', async (request, reply) => {
    if (!requireRole(request, reply, ADMIN_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const admin = getSupabaseAdmin()
    if (!admin) {
      reply.code(503).send({ error: { code: 'DATABASE_NOT_CONFIGURED', message: 'Supabase is not configured yet.' } })
      return
    }
    const { id } = idParamsSchema.parse(request.params)
    const source = await getTenderSourceById(supabase, id)
    if (!source) {
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Tender source not found.' } })
      return
    }
    if (source.adapter_state !== 'ACTIVE') {
      reply.code(409).send({
        error: { code: 'NOT_ACTIVE', message: 'Only a currently active source can be paused.' },
      })
      return
    }
    const pausedAt = new Date().toISOString()
    return updateTenderSourceState(admin, id, { adapterState: 'PAUSED', pausedAt, healthStatus: 'DISABLED' })
  })

  app.post('/api/tender-sources/:id/resume', async (request, reply) => {
    if (!requireRole(request, reply, ADMIN_ROLES)) return
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const admin = getSupabaseAdmin()
    if (!admin) {
      reply.code(503).send({ error: { code: 'DATABASE_NOT_CONFIGURED', message: 'Supabase is not configured yet.' } })
      return
    }
    const { id } = idParamsSchema.parse(request.params)
    const source = await getTenderSourceById(supabase, id)
    if (!source) {
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Tender source not found.' } })
      return
    }
    if (source.adapter_state !== 'PAUSED') {
      reply.code(409).send({
        error: { code: 'NOT_PAUSED', message: 'Only a currently paused source can be resumed.' },
      })
      return
    }
    const consecutiveFailedScans = await countConsecutiveFailedScans(supabase, id)
    const healthStatus = computeSourceHealth({
      hasAdapter: true,
      active: source.active,
      adapterState: 'ACTIVE',
      consecutiveFailedScans,
    })
    return updateTenderSourceState(admin, id, { adapterState: 'ACTIVE', pausedAt: null, healthStatus })
  })
}
