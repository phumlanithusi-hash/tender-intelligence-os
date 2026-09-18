import { describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { requireAuth } from '../auth.js'

describe('requireAuth', () => {
  it('rejects a request with no Authorization header', async () => {
    const app = Fastify()
    app.get('/protected', { preHandler: requireAuth }, () => ({ ok: true }))

    const response = await app.inject({ method: 'GET', url: '/protected' })
    expect(response.statusCode).toBe(401)
    expect(response.json().error.code).toBe('UNAUTHENTICATED')
    await app.close()
  })

  it('reports AUTH_NOT_CONFIGURED when Supabase env vars are absent (Phase 1 default)', async () => {
    const app = Fastify()
    app.get('/protected', { preHandler: requireAuth }, () => ({ ok: true }))

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Bearer some-token' },
    })
    expect(response.statusCode).toBe(503)
    expect(response.json().error.code).toBe('AUTH_NOT_CONFIGURED')
    await app.close()
  })
})
