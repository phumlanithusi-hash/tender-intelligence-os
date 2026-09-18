import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth.js'
import { requireSupabase } from '../lib/requireSupabase.js'
import { listWatchlist, addToWatchlist, removeFromWatchlist } from '../repositories/watchlist.js'

const addWatchlistBodySchema = z.object({
  tenderId: z.string().uuid(),
  notes: z.string().max(2000).optional(),
})
const tenderIdParamsSchema = z.object({ tenderId: z.string().uuid() })

/**
 * Watchlist routes (Phase 3 §15). Every write requires a resolved
 * `agencyId` — a caller with no `users` row yet (mid-onboarding) gets
 * a clear 409 rather than a write that would fail RLS anyway with a
 * far less helpful error, or worse, one written with a null agency_id
 * that a NOT NULL constraint would then reject.
 */
export async function watchlistRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth)

  app.get('/api/watchlist', async (request, reply) => {
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    return { rows: await listWatchlist(supabase) }
  })

  app.post('/api/watchlist', async (request, reply) => {
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    if (!request.user?.agencyId) {
      reply.code(409).send({
        error: { code: 'NO_AGENCY', message: 'Your account is not yet associated with an agency.' },
      })
      return
    }
    const body = addWatchlistBodySchema.parse(request.body)
    const row = await addToWatchlist(supabase, {
      agencyId: request.user.agencyId,
      userId: request.user.id,
      tenderId: body.tenderId,
      notes: body.notes,
    })
    reply.code(201)
    return row
  })

  app.delete('/api/watchlist/:tenderId', async (request, reply) => {
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { tenderId } = tenderIdParamsSchema.parse(request.params)
    await removeFromWatchlist(supabase, tenderId)
    reply.code(204)
  })
}
