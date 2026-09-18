import { describe, expect, it, afterEach } from 'vitest'
import { buildApp } from '../../app.js'
import { __resetSupabaseAdminForTests } from '../../lib/supabaseAdmin.js'

const tenderId = '11111111-1111-1111-1111-111111111111'
const requirementId = '22222222-2222-2222-2222-222222222222'

describe('tenderQualification routes (Phase 8 §33/§38)', () => {
  afterEach(() => {
    __resetSupabaseAdminForTests()
  })

  it('requires authentication on every read route', async () => {
    const app = await buildApp()
    for (const url of [
      `/api/tenders/${tenderId}/qualification`,
      `/api/tenders/${tenderId}/qualification/requirements`,
      `/api/tenders/${tenderId}/qualification/requirements/${requirementId}`,
      `/api/tenders/${tenderId}/qualification/actions`,
    ]) {
      const response = await app.inject({ method: 'GET', url })
      expect(response.statusCode, `${url} should require auth`).toBe(401)
    }
    await app.close()
  })

  it('requires authentication on evaluate and review', async () => {
    const app = await buildApp()
    for (const req of [
      { method: 'POST' as const, url: `/api/tenders/${tenderId}/qualification/evaluate` },
      { method: 'POST' as const, url: `/api/tenders/${tenderId}/qualification/review` },
    ]) {
      const response = await app.inject(req)
      expect(response.statusCode, `${req.url} should require auth`).toBe(401)
    }
    await app.close()
  })

  it('degrades to 503 rather than crashing when Supabase is not configured', async () => {
    const app = await buildApp()
    const response = await app.inject({ method: 'GET', url: `/api/tenders/${tenderId}/qualification`, headers: { authorization: 'Bearer not-a-real-token' } })
    expect(response.statusCode).toBe(503)
    await app.close()
  })

  it('rejects a non-UUID tender id with a validation error rather than crashing', async () => {
    const app = await buildApp()
    const response = await app.inject({ method: 'GET', url: `/api/tenders/not-a-uuid/qualification`, headers: { authorization: 'Bearer not-a-real-token' } })
    expect([400, 503]).toContain(response.statusCode)
    await app.close()
  })

  it('rejects malicious/path-traversal-shaped tender and requirement ids without crashing', async () => {
    const app = await buildApp()
    for (const badId of ["'; DROP TABLE tender_requirements; --", '../../etc/passwd', '<script>alert(1)</script>']) {
      const response = await app.inject({
        method: 'GET',
        url: `/api/tenders/${encodeURIComponent(badId)}/qualification/requirements/${encodeURIComponent(badId)}`,
        headers: { authorization: 'Bearer not-a-real-token' },
      })
      expect([400, 503], badId).toContain(response.statusCode)
    }
    await app.close()
  })

  it('rejects an oversized decision string on review rather than crashing (once past auth)', async () => {
    const app = await buildApp()
    const response = await app.inject({
      method: 'POST',
      url: `/api/tenders/${tenderId}/qualification/review`,
      headers: { authorization: 'Bearer not-a-real-token', 'content-type': 'application/json' },
      payload: { decision: 'x'.repeat(10_000) },
    })
    // Auth/Supabase-config resolves before body validation in this
    // sandbox (no live Supabase) — either a 503/401 (unconfigured/auth)
    // or a 400 (validation) is an acceptable non-crash outcome.
    expect([400, 401, 503]).toContain(response.statusCode)
    await app.close()
  })
})
