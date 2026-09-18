import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../app.js'
import { __resetSupabaseAdminForTests } from '../../lib/supabaseAdmin.js'

const bidId = '11111111-1111-1111-1111-111111111111'
const addendumId = '22222222-2222-2222-2222-222222222222'

describe('addenda routes (Phase 19 §12)', () => {
  afterEach(() => {
    __resetSupabaseAdminForTests()
  })

  it('requires authentication on every route', async () => {
    const app = await buildApp()
    const getResponse = await app.inject({ method: 'GET', url: `/api/bids/${bidId}/addenda` })
    expect(getResponse.statusCode).toBe(401)
    const postResponse = await app.inject({ method: 'POST', url: `/api/bids/${bidId}/addenda/${addendumId}/acknowledge` })
    expect(postResponse.statusCode).toBe(401)
    await app.close()
  })

  it('degrades to 503 rather than crashing when Supabase is not configured', async () => {
    const app = await buildApp()
    const response = await app.inject({ method: 'GET', url: `/api/bids/${bidId}/addenda`, headers: { authorization: 'Bearer not-a-real-token' } })
    expect(response.statusCode).toBe(503)
    await app.close()
  })
})
