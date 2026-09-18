import { describe, expect, it, afterEach } from 'vitest'
import { buildApp } from '../../app.js'
import { __resetSupabaseAdminForTests } from '../../lib/supabaseAdmin.js'

const tenderId = '11111111-1111-1111-1111-111111111111'

describe('tenderScoring routes (Phase 10 §37/§38)', () => {
  afterEach(() => {
    __resetSupabaseAdminForTests()
  })

  it('requires authentication on every read route', async () => {
    const app = await buildApp()
    for (const url of [
      `/api/tenders/${tenderId}/opportunity-score`,
      `/api/tenders/${tenderId}/opportunity-score/components`,
      `/api/tenders/${tenderId}/opportunity-score/drivers`,
      `/api/tenders/${tenderId}/opportunity-score/risks`,
      `/api/tenders/${tenderId}/opportunity-score/gates`,
      `/api/tenders/${tenderId}/opportunity-score/runs`,
      `/api/scoring/configurations`,
    ]) {
      const response = await app.inject({ method: 'GET', url })
      expect(response.statusCode, `${url} should require auth`).toBe(401)
    }
    await app.close()
  })

  it('requires authentication on the score-trigger action', async () => {
    const app = await buildApp()
    const response = await app.inject({ method: 'POST', url: `/api/tenders/${tenderId}/opportunity-score` })
    expect(response.statusCode).toBe(401)
    await app.close()
  })

  it('degrades to 503 rather than crashing when Supabase is not configured', async () => {
    const app = await buildApp()
    const response = await app.inject({ method: 'GET', url: `/api/tenders/${tenderId}/opportunity-score`, headers: { authorization: 'Bearer not-a-real-token' } })
    expect(response.statusCode).toBe(503)
    await app.close()
  })

  it('rejects a non-UUID tender id with a validation error rather than crashing', async () => {
    const app = await buildApp()
    const response = await app.inject({ method: 'GET', url: `/api/tenders/not-a-uuid/opportunity-score`, headers: { authorization: 'Bearer not-a-real-token' } })
    expect([400, 503]).toContain(response.statusCode)
    await app.close()
  })

  it('rejects malicious/path-traversal-shaped tender ids without crashing', async () => {
    const app = await buildApp()
    for (const badId of ["'; DROP TABLE tender_scoring_runs; --", '../../etc/passwd', '<script>alert(1)</script>']) {
      const response = await app.inject({ method: 'GET', url: `/api/tenders/${encodeURIComponent(badId)}/opportunity-score`, headers: { authorization: 'Bearer not-a-real-token' } })
      expect([400, 503], badId).toContain(response.statusCode)
    }
    await app.close()
  })

  it('does not collide with the pre-existing legacy /api/tenders/:id/score route (Phase 3)', async () => {
    const app = await buildApp()
    const legacy = await app.inject({ method: 'GET', url: `/api/tenders/${tenderId}/score`, headers: { authorization: 'Bearer not-a-real-token' } })
    const phase10 = await app.inject({ method: 'GET', url: `/api/tenders/${tenderId}/opportunity-score`, headers: { authorization: 'Bearer not-a-real-token' } })
    expect(legacy.statusCode).not.toBe(404)
    expect(phase10.statusCode).not.toBe(404)
    await app.close()
  })
})
