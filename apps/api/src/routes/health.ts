import type { FastifyInstance } from 'fastify'
import type { HealthCheckResponse } from '@tender-os/schemas'
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js'

/**
 * GET /api/health — required by Phase 1 acceptance test
 * (build execution §6). Reports real connectivity, never a hard-coded
 * "ok" — if Supabase isn't configured or a check query fails, that is
 * surfaced as `degraded`/`error`, not hidden.
 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/health', async (): Promise<HealthCheckResponse> => {
    const supabase = getSupabaseAdmin()
    let database: HealthCheckResponse['checks']['database'] = 'not_configured'

    if (supabase) {
      try {
        // Lightweight call that only requires a valid connection, not
        // any particular schema — safe to run before Phase 2 migrations exist.
        const { error } = await supabase.auth.getSession()
        database = error ? 'error' : 'ok'
      } catch {
        database = 'error'
      }
    }

    return {
      status: database === 'error' ? 'degraded' : 'ok',
      service: '@tender-os/api',
      timestamp: new Date().toISOString(),
      checks: { database },
    }
  })
}
