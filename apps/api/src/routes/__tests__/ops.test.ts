import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../app.js'
import { __resetSupabaseAdminForTests } from '../../lib/supabaseAdmin.js'

describe('ops health route (Phase 19 §16)', () => {
  afterEach(() => {
    __resetSupabaseAdminForTests()
  })

  it('requires authentication', async () => {
    const app = await buildApp()
    const response = await app.inject({ method: 'GET', url: '/api/ops/health' })
    expect(response.statusCode).toBe(401)
    await app.close()
  })

  it('degrades to 503 rather than crashing when Supabase is not configured', async () => {
    const app = await buildApp()
    const response = await app.inject({ method: 'GET', url: '/api/ops/health', headers: { authorization: 'Bearer not-a-real-token' } })
    expect(response.statusCode).toBe(503)
    await app.close()
  })
})
