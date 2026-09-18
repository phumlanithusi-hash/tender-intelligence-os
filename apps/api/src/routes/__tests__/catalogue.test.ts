import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../app.js'
import { __resetSupabaseAdminForTests } from '../../lib/supabaseAdmin.js'

/**
 * Route-level wiring tests only — the routes are exercised end-to-end
 * against RLS in database/src/__tests__/schema.test.ts (Postgres is
 * the real authority there). These tests confirm the HTTP layer's own
 * contract: auth is required, and a missing Supabase config degrades
 * to 503 rather than crashing or silently returning empty data.
 */
describe('catalogue routes', () => {
  afterEach(() => {
    __resetSupabaseAdminForTests()
  })

  it('requires authentication on every catalogue route', async () => {
    const app = await buildApp()
    for (const url of ['/api/tender-sources', '/api/services']) {
      const response = await app.inject({ method: 'GET', url })
      expect(response.statusCode, `${url} should require auth`).toBe(401)
    }
    await app.close()
  })

  it('returns 503 when Supabase is not configured, even with a syntactically valid bearer token', async () => {
    const app = await buildApp()
    // requireAuth itself 503s before reaching the route when Supabase
    // env vars are absent (middleware/auth.ts), which is the same
    // "not configured" signal the route's own requireSupabase() guard
    // exists for — both paths degrade rather than crash.
    const response = await app.inject({
      method: 'GET',
      url: '/api/tender-sources',
      headers: { authorization: 'Bearer not-a-real-token' },
    })
    expect(response.statusCode).toBe(503)
    await app.close()
  })
})
