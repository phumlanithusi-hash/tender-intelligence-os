import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth.js'
import { requireSupabase } from '../lib/requireSupabase.js'
import { listSavedFilters, createSavedFilter, deleteSavedFilter } from '../repositories/savedFilters.js'

const createSavedFilterBodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  // The exact /api/tenders query-parameter shape (routes/tenders.ts) —
  // stored opaquely rather than re-validated field-by-field here, so
  // this table never needs its own schema migration when a new
  // /api/tenders filter is added (Phase 3 §16: "do not over-engineer
  // this feature").
  filter: z.record(z.string(), z.unknown()),
})
const idParamsSchema = z.object({ id: z.string().uuid() })

/** Saved filter routes (Phase 3 §16). */
export async function savedFiltersRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth)

  app.get('/api/saved-filters', async (request, reply) => {
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    return { rows: await listSavedFilters(supabase) }
  })

  app.post('/api/saved-filters', async (request, reply) => {
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    if (!request.user?.agencyId) {
      reply.code(409).send({
        error: { code: 'NO_AGENCY', message: 'Your account is not yet associated with an agency.' },
      })
      return
    }
    const body = createSavedFilterBodySchema.parse(request.body)
    const row = await createSavedFilter(supabase, {
      agencyId: request.user.agencyId,
      userId: request.user.id,
      name: body.name,
      filter: body.filter,
    })
    reply.code(201)
    return row
  })

  app.delete('/api/saved-filters/:id', async (request, reply) => {
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id } = idParamsSchema.parse(request.params)
    await deleteSavedFilter(supabase, id)
    reply.code(204)
  })
}
