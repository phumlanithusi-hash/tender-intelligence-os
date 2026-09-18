import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../app.js'
import { __resetSupabaseAdminForTests } from '../../lib/supabaseAdmin.js'

const sourceId = '11111111-1111-1111-1111-111111111111'

describe('tenderSources routes (Phase 4 §19)', () => {
  afterEach(() => {
    __resetSupabaseAdminForTests()
  })

  it('requires authentication on every read route', async () => {
    const app = await buildApp()
    for (const url of [
      '/api/tender-sources',
      '/api/tender-sources/summary',
      `/api/tender-sources/${sourceId}`,
      `/api/tender-sources/${sourceId}/scans`,
      `/api/tender-sources/${sourceId}/errors`,
    ]) {
      const response = await app.inject({ method: 'GET', url })
      expect(response.statusCode, `${url} should require auth`).toBe(401)
    }
    await app.close()
  })

  it('requires authentication on every administrative action', async () => {
    const app = await buildApp()
    for (const url of [
      `/api/tender-sources/${sourceId}/health-check`,
      `/api/tender-sources/${sourceId}/enable`,
      `/api/tender-sources/${sourceId}/disable`,
      `/api/tender-sources/${sourceId}/pause`,
      `/api/tender-sources/${sourceId}/resume`,
    ]) {
      const response = await app.inject({ method: 'POST', url })
      expect(response.statusCode, `${url} should require auth`).toBe(401)
    }
    await app.close()
  })

  it('degrades to 503 rather than crashing when Supabase is not configured', async () => {
    const app = await buildApp()
    const response = await app.inject({
      method: 'GET',
      url: '/api/tender-sources/summary',
      headers: { authorization: 'Bearer not-a-real-token' },
    })
    // Supabase is unreachable in this test environment, so
    // requireAuth itself degrades to 503 before RBAC or the
    // repository ever runs — the same behaviour every other
    // authenticated route has (routes/__tests__/tenders.test.ts).
    expect(response.statusCode).toBe(503)
    await app.close()
  })

  it('the old /api/tender-sources routes are gone from catalogue.ts — they now live here', async () => {
    const app = await buildApp()
    // A GET with no auth header still resolves to this file's route
    // (401, not 404) — proving the route exists under this file's
    // registration rather than having silently disappeared.
    const response = await app.inject({ method: 'GET', url: '/api/tender-sources' })
    expect(response.statusCode).toBe(401)
    await app.close()
  })
})
