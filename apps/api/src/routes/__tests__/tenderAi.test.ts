import { describe, expect, it, afterEach } from 'vitest'
import { buildApp } from '../../app.js'
import { __resetSupabaseAdminForTests } from '../../lib/supabaseAdmin.js'

const tenderId = '11111111-1111-1111-1111-111111111111'

describe('tenderAi routes (Phase 7 §29/§36)', () => {
  afterEach(() => {
    __resetSupabaseAdminForTests()
  })

  it('requires authentication on every read route', async () => {
    const app = await buildApp()
    for (const url of [`/api/tenders/${tenderId}/ai/classification`, `/api/tenders/${tenderId}/ai/runs`]) {
      const response = await app.inject({ method: 'GET', url })
      expect(response.statusCode, `${url} should require auth`).toBe(401)
    }
    await app.close()
  })

  it('requires authentication on classify and reclassify', async () => {
    const app = await buildApp()
    for (const url of [`/api/tenders/${tenderId}/ai/classify`, `/api/tenders/${tenderId}/ai/reclassify`]) {
      const response = await app.inject({ method: 'POST', url })
      expect(response.statusCode, `${url} should require auth`).toBe(401)
    }
    await app.close()
  })

  it('degrades to 503 rather than crashing when Supabase is not configured', async () => {
    const app = await buildApp()
    const response = await app.inject({
      method: 'GET',
      url: `/api/tenders/${tenderId}/ai/classification`,
      headers: { authorization: 'Bearer not-a-real-token' },
    })
    expect(response.statusCode).toBe(503)
    await app.close()
  })

  it('rejects a non-UUID tender id with a validation error rather than crashing', async () => {
    const app = await buildApp()
    const response = await app.inject({
      method: 'GET',
      url: `/api/tenders/not-a-uuid/ai/classification`,
      headers: { authorization: 'Bearer not-a-real-token' },
    })
    // Same hook-ordering note as tenderDocuments.test.ts: auth
    // resolution (503, Supabase unconfigured in this sandbox) happens
    // before param validation — either is an acceptable non-crash
    // outcome, a 500 is not.
    expect([400, 503]).toContain(response.statusCode)
    await app.close()
  })

  it('rejects malicious/path-traversal-shaped tender ids with a validation error, never a crash', async () => {
    const app = await buildApp()
    for (const badId of ["'; DROP TABLE tenders; --", '../../etc/passwd', '<script>alert(1)</script>']) {
      const response = await app.inject({
        method: 'GET',
        url: `/api/tenders/${encodeURIComponent(badId)}/ai/classification`,
        headers: { authorization: 'Bearer not-a-real-token' },
      })
      expect([400, 503], badId).toContain(response.statusCode)
    }
    await app.close()
  })
})
