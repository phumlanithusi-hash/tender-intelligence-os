import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { listNotificationsQuerySchema } from '@tender-os/schemas'
import { requireAuth } from '../middleware/auth.js'
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js'
import { createSupabaseNotificationStore } from '../lib/notifications/supabaseNotificationStore.js'
import { runNotificationCheck } from '../lib/notifications/check.js'
import { logOperation } from '../lib/observability/requestLog.js'

const idParams = z.object({ id: z.string().uuid() })

/**
 * Phase 19 gap-closing (spec §15) — the real, wired, user-facing
 * notification inbox API. Path checked against every existing
 * routes/*.ts file first: `/api/notifications*` collides with
 * nothing already registered in app.ts.
 *
 * Every handler resolves `agencyId`/`userId` from the server-verified
 * `request.user` (never from the request body/query — spec §24), and
 * every store call additionally filters by both, so one agency's
 * users can never read or dismiss another agency's (or another
 * user's) notifications even if the row's id is guessed (spec §22 —
 * see docs/SECURITY.md's Phase 19 gap-closing audit section for the
 * matching DB-level RLS tightening in
 * 20260913100000_notifications_v2.sql).
 */
export async function notificationsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth)

  function admin(reply: FastifyReply) {
    const client = getSupabaseAdmin()
    if (!client) {
      reply.code(503).send({ error: { code: 'DATABASE_NOT_CONFIGURED', message: 'Supabase is not configured yet.' } })
      return null
    }
    return client
  }

  function agencyAndUser(request: FastifyRequest, reply: FastifyReply): { agencyId: string; userId: string } | null {
    const agencyId = request.user?.agencyId
    const userId = request.user?.id
    if (!agencyId || !userId) {
      reply.code(422).send({ error: { code: 'NO_AGENCY', message: 'Your account is not associated with an agency.' } })
      return null
    }
    return { agencyId, userId }
  }

  app.get('/api/notifications', async (request, reply) => {
    const supabase = admin(reply)
    if (!supabase) return
    const ctx = agencyAndUser(request, reply)
    if (!ctx) return
    const query = listNotificationsQuerySchema.safeParse(request.query)
    if (!query.success) {
      reply.code(400).send({ error: { code: 'INVALID_QUERY', message: query.error.message } })
      return
    }
    const store = createSupabaseNotificationStore(supabase)
    const data = await store.list({ agencyId: ctx.agencyId, userId: ctx.userId, unreadOnly: query.data.unreadOnly, includeDismissed: query.data.includeDismissed, limit: query.data.limit })
    reply.send({ data })
  })

  app.get('/api/notifications/unread-count', async (request, reply) => {
    const supabase = admin(reply)
    if (!supabase) return
    const ctx = agencyAndUser(request, reply)
    if (!ctx) return
    const store = createSupabaseNotificationStore(supabase)
    const count = await store.countUnread(ctx.agencyId, ctx.userId)
    reply.send({ data: { count } })
  })

  app.post('/api/notifications/:id/read', async (request, reply) => {
    const supabase = admin(reply)
    if (!supabase) return
    const ctx = agencyAndUser(request, reply)
    if (!ctx) return
    const params = idParams.parse(request.params)
    const store = createSupabaseNotificationStore(supabase)
    const updated = await store.markRead(params.id, ctx.agencyId, ctx.userId)
    if (!updated) {
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Notification not found.' } })
      return
    }
    reply.send({ data: updated })
  })

  app.post('/api/notifications/:id/dismiss', async (request, reply) => {
    const supabase = admin(reply)
    if (!supabase) return
    const ctx = agencyAndUser(request, reply)
    if (!ctx) return
    const params = idParams.parse(request.params)
    const store = createSupabaseNotificationStore(supabase)
    const updated = await store.dismiss(params.id, ctx.agencyId, ctx.userId)
    if (!updated) {
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Notification not found.' } })
      return
    }
    reply.send({ data: updated })
  })

  // On-demand fan-out for the time-based/derived triggers (spec §15)
  // — see lib/notifications/check.ts's doc-comment for why this is a
  // "check" action rather than a scheduler (no BullMQ/Redis/queue
  // exists anywhere in this codebase — Phase 19 binding constraint
  // against overbuilding). A real client (the bell UI, or a future
  // cron-triggered call) invokes this periodically or on page load.
  app.post('/api/notifications/check', async (request, reply) => {
    const supabase = admin(reply)
    if (!supabase) return
    const ctx = agencyAndUser(request, reply)
    if (!ctx) return
    const start = Date.now()
    const store = createSupabaseNotificationStore(supabase)
    const created = await runNotificationCheck(supabase, store, ctx.agencyId, ctx.userId)
    logOperation({
      requestId: request.id,
      agencyId: ctx.agencyId,
      userId: ctx.userId,
      entityId: null,
      operation: 'notifications.check',
      status: 'SUCCESS',
      durationMs: Date.now() - start,
    })
    reply.send({ data: { created } })
  })
}
