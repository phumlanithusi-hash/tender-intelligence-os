import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../app.js'
import { __resetSupabaseAdminForTests } from '../../lib/supabaseAdmin.js'

const violationId = '11111111-1111-1111-1111-111111111111'

describe('data quality routes (Phase 19 §17/§18)', () => {
  afterEach(() => {
    __resetSupabaseAdminForTests()
  })

  it('requires authentication on every route', async () => {
    const app = await buildApp()
    for (const req of [
      { method: 'POST' as const, url: '/api/data-quality/scan' },
      { method: 'GET' as const, url: '/api/data-quality/violations' },
      { method: 'POST' as const, url: `/api/data-quality/violations/${violationId}/resolve` },
      { method: 'GET' as const, url: '/api/data-quality/completeness' },
    ]) {
      const response = await app.inject(req)
      expect(response.statusCode, `${req.method} ${req.url}`).toBe(401)
    }
    await app.close()
  })

  it('degrades to 503 rather than crashing when Supabase is not configured', async () => {
    const app = await buildApp()
    const response = await app.inject({ method: 'GET', url: '/api/data-quality/violations', headers: { authorization: 'Bearer not-a-real-token' } })
    expect(response.statusCode).toBe(503)
    await app.close()
  })
})
