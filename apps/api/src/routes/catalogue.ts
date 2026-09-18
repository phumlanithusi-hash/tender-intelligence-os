import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth.js'
import { requireSupabase } from '../lib/requireSupabase.js'
import { listServices, listServiceSubcategories } from '../repositories/services.js'

const idParamsSchema = z.object({ id: z.string().uuid() })

/**
 * Read-only routes over the small, mostly-static Phase 2 service
 * taxonomy. The tender source registry moved to its own file,
 * routes/tenderSources.ts (Phase 4 §19), once it grew RBAC-gated
 * administrative actions of its own — this file is intentionally
 * kept small.
 */
export async function catalogueRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth)

  app.get('/api/services', async (request, reply) => {
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    return { rows: await listServices(supabase) }
  })

  app.get('/api/services/:id/subcategories', async (request, reply) => {
    const supabase = requireSupabase(request, reply)
    if (!supabase) return
    const { id } = idParamsSchema.parse(request.params)
    return { rows: await listServiceSubcategories(supabase, id) }
  })
}
