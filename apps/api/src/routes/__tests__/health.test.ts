import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../app.js'
import { healthCheckResponseSchema } from '@tender-os/schemas'
import { __resetSupabaseAdminForTests } from '../../lib/supabaseAdmin.js'

describe('GET /api/health', () => {
  afterEach(() => {
    __resetSupabaseAdminForTests()
  })

  it('returns a schema-valid response with database not_configured when Supabase env vars are absent', async () => {
    const app = await buildApp()
    const response = await app.inject({ method: 'GET', url: '/api/health' })

    expect(response.statusCode).toBe(200)
    const body = response.json()
    const parsed = healthCheckResponseSchema.safeParse(body)
    expect(parsed.success).toBe(true)
    expect(body.checks.database).toBe('not_configured')
    expect(body.status).toBe('ok')

    await app.close()
  })
})
