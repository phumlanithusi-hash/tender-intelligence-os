import type { FastifyInstance } from 'fastify'
import { requireAuth } from '../middleware/auth.js'

/**
 * The caller's own resolved profile (id/email/role/agencyId/fullName
 * — middleware/auth.ts's enrichment). Small and deliberately
 * single-purpose: the frontend needs this to know whether to show
 * admin-only Source Registry actions (Phase 4 §18) without
 * duplicating role logic on the client — the server remains the only
 * place that decides what a role can actually do (every mutating
 * route re-checks with requireRole regardless of what the UI shows).
 */
export async function meRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth)

  app.get('/api/me', async (request) => {
    return request.user
  })
}
