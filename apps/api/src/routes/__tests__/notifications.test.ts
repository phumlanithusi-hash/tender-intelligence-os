import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../app.js'
import { __resetSupabaseAdminForTests } from '../../lib/supabaseAdmin.js'

describe('notifications routes (Phase 19 gap-closing, spec §15)', () => {
  afterEach(() => {
    __resetSupabaseAdminForTests()
  })

  const endpoints: Array<{ method: 'GET' | 'POST'; url: string }> = [
    { method: 'GET', url: '/api/notifications' },
    { method: 'GET', url: '/api/notifications/unread-count' },
    { method: 'POST', url: '/api/notifications/00000000-0000-0000-0000-000000000000/read' },
    { method: 'POST', url: '/api/notifications/00000000-0000-0000-0000-000000000000/dismiss' },
    { method: 'POST', url: '/api/notifications/check' },
  ]

  for (const endpoint of endpoints) {
    it(`${endpoint.method} ${endpoint.url} requires authentication`, async () => {
      const app = await buildApp()
      const response = await app.inject({ method: endpoint.method, url: endpoint.url })
      expect(response.statusCode).toBe(401)
      await app.close()
    })

    it(`${endpoint.method} ${endpoint.url} degrades to 503 rather than crashing when Supabase is not configured`, async () => {
      const app = await buildApp()
      const response = await app.inject({ method: endpoint.method, url: endpoint.url, headers: { authorization: 'Bearer not-a-real-token' } })
      expect(response.statusCode).toBe(503)
      await app.close()
    })
  }
})
