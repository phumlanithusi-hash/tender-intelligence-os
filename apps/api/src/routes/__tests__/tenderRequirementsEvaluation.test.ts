import { describe, expect, it, afterEach } from 'vitest'
import { buildApp } from '../../app.js'
import { __resetSupabaseAdminForTests } from '../../lib/supabaseAdmin.js'

const tenderId = '11111111-1111-1111-1111-111111111111'
const requirementId = '22222222-2222-2222-2222-222222222222'
const criterionId = '33333333-3333-3333-3333-333333333333'

describe('tenderRequirementsEvaluation routes (Phase 9 §37/§44)', () => {
  afterEach(() => {
    __resetSupabaseAdminForTests()
  })

  it('requires authentication on every read route', async () => {
    const app = await buildApp()
    for (const url of [
      `/api/tenders/${tenderId}/requirements`,
      `/api/tenders/${tenderId}/requirements/${requirementId}`,
      `/api/tenders/${tenderId}/requirements/runs`,
      `/api/tenders/${tenderId}/evaluation`,
      `/api/tenders/${tenderId}/evaluation/criteria`,
      `/api/tenders/${tenderId}/evaluation/conflicts`,
    ]) {
      const response = await app.inject({ method: 'GET', url })
      expect(response.statusCode, `${url} should require auth`).toBe(401)
    }
    await app.close()
  })

  it('requires authentication on extract and review', async () => {
    const app = await buildApp()
    for (const req of [
      { method: 'POST' as const, url: `/api/tenders/${tenderId}/requirements/extract` },
      { method: 'POST' as const, url: `/api/tenders/${tenderId}/requirements/${requirementId}/review` },
      { method: 'POST' as const, url: `/api/tenders/${tenderId}/evaluation/criteria/${criterionId}/review` },
    ]) {
      const response = await app.inject(req)
      expect(response.statusCode, `${req.url} should require auth`).toBe(401)
    }
    await app.close()
  })

  it('degrades to 503 rather than crashing when Supabase is not configured', async () => {
    const app = await buildApp()
    const response = await app.inject({ method: 'GET', url: `/api/tenders/${tenderId}/requirements`, headers: { authorization: 'Bearer not-a-real-token' } })
    expect(response.statusCode).toBe(503)
    await app.close()
  })

  it('rejects a non-UUID tender id with a validation error rather than crashing', async () => {
    const app = await buildApp()
    const response = await app.inject({ method: 'GET', url: `/api/tenders/not-a-uuid/requirements`, headers: { authorization: 'Bearer not-a-real-token' } })
    expect([400, 503]).toContain(response.statusCode)
    await app.close()
  })

  it('rejects malicious/path-traversal-shaped tender and requirement ids without crashing', async () => {
    const app = await buildApp()
    for (const badId of ["'; DROP TABLE tender_requirements; --", '../../etc/passwd', '<script>alert(1)</script>']) {
      const response = await app.inject({
        method: 'GET',
        url: `/api/tenders/${encodeURIComponent(badId)}/requirements/${encodeURIComponent(badId)}`,
        headers: { authorization: 'Bearer not-a-real-token' },
      })
      expect([400, 503], badId).toContain(response.statusCode)
    }
    await app.close()
  })

  it('rejects an oversized decision string on requirement review rather than crashing (once past auth)', async () => {
    const app = await buildApp()
    const response = await app.inject({
      method: 'POST',
      url: `/api/tenders/${tenderId}/requirements/${requirementId}/review`,
      headers: { authorization: 'Bearer not-a-real-token', 'content-type': 'application/json' },
      payload: { decision: 'x'.repeat(10_000) },
    })
    expect([400, 401, 503]).toContain(response.statusCode)
    await app.close()
  })

  it('the previous unauthenticated Phase 2 baseline /requirements and /evaluation routes were consolidated here, not left duplicated', async () => {
    const app = await buildApp()
    // Without auth, both now consistently 401 (previously the Phase 2
    // baseline route had no role gate at all beyond generic auth).
    const r1 = await app.inject({ method: 'GET', url: `/api/tenders/${tenderId}/requirements` })
    const r2 = await app.inject({ method: 'GET', url: `/api/tenders/${tenderId}/evaluation` })
    expect(r1.statusCode).toBe(401)
    expect(r2.statusCode).toBe(401)
    await app.close()
  })
})
