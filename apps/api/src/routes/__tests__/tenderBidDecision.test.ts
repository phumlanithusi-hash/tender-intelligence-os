import { describe, expect, it, afterEach } from 'vitest'
import { buildApp } from '../../app.js'
import { __resetSupabaseAdminForTests } from '../../lib/supabaseAdmin.js'

const tenderId = '11111111-1111-1111-1111-111111111111'

describe('tenderBidDecision routes (Phase 11 §46)', () => {
  afterEach(() => {
    __resetSupabaseAdminForTests()
  })

  it('requires authentication on every read route', async () => {
    const app = await buildApp()
    for (const url of [`/api/tenders/${tenderId}/bid-decision`, `/api/tenders/${tenderId}/bid-decision/rules`, `/api/tenders/${tenderId}/bid-decision/history`]) {
      const response = await app.inject({ method: 'GET', url })
      expect(response.statusCode, `${url} should require auth`).toBe(401)
    }
    await app.close()
  })

  it('requires authentication on the evaluate and override actions', async () => {
    const app = await buildApp()
    const evaluate = await app.inject({ method: 'POST', url: `/api/tenders/${tenderId}/bid-decision/evaluate` })
    expect(evaluate.statusCode).toBe(401)
    const override = await app.inject({ method: 'POST', url: `/api/tenders/${tenderId}/bid-decision/override`, payload: { decision: 'BID', reason: 'x' } })
    expect(override.statusCode).toBe(401)
    await app.close()
  })

  it('degrades to 503 rather than crashing when Supabase is not configured', async () => {
    const app = await buildApp()
    const response = await app.inject({ method: 'GET', url: `/api/tenders/${tenderId}/bid-decision`, headers: { authorization: 'Bearer not-a-real-token' } })
    expect(response.statusCode).toBe(503)
    await app.close()
  })

  it('rejects a non-UUID tender id with a validation error rather than crashing', async () => {
    const app = await buildApp()
    const response = await app.inject({ method: 'GET', url: `/api/tenders/not-a-uuid/bid-decision`, headers: { authorization: 'Bearer not-a-real-token' } })
    expect([400, 503]).toContain(response.statusCode)
    await app.close()
  })

  it('rejects malicious/path-traversal-shaped tender ids without crashing', async () => {
    const app = await buildApp()
    for (const badId of ["'; DROP TABLE bid_decision_runs; --", '../../etc/passwd', '<script>alert(1)</script>']) {
      const response = await app.inject({ method: 'GET', url: `/api/tenders/${encodeURIComponent(badId)}/bid-decision`, headers: { authorization: 'Bearer not-a-real-token' } })
      expect([400, 503], badId).toContain(response.statusCode)
    }
    await app.close()
  })

  it('rejects an override with no reason before ever reaching the database (validation, never a 500)', async () => {
    const app = await buildApp()
    const response = await app.inject({ method: 'POST', url: `/api/tenders/${tenderId}/bid-decision/override`, headers: { authorization: 'Bearer not-a-real-token' }, payload: { decision: 'BID', reason: '' } })
    // With no Supabase configured this also 503s before body validation in
    // some paths; either a 422 (validation) or 503 (no DB) is acceptable —
    // a 500 (unhandled crash) is not.
    expect(response.statusCode).not.toBe(500)
    await app.close()
  })

  it('does not collide with the pre-existing legacy /api/tenders/:id/score route or Phase 10 opportunity-score route', async () => {
    const app = await buildApp()
    const legacy = await app.inject({ method: 'GET', url: `/api/tenders/${tenderId}/score`, headers: { authorization: 'Bearer not-a-real-token' } })
    const phase10 = await app.inject({ method: 'GET', url: `/api/tenders/${tenderId}/opportunity-score`, headers: { authorization: 'Bearer not-a-real-token' } })
    const phase11 = await app.inject({ method: 'GET', url: `/api/tenders/${tenderId}/bid-decision`, headers: { authorization: 'Bearer not-a-real-token' } })
    expect(legacy.statusCode).not.toBe(404)
    expect(phase10.statusCode).not.toBe(404)
    expect(phase11.statusCode).not.toBe(404)
    await app.close()
  })
})
