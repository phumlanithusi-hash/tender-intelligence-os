import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../app.js'
import { __resetSupabaseAdminForTests } from '../../lib/supabaseAdmin.js'
import { tenderListQuerySchema } from '../tenders.js'

const tenderId = '11111111-1111-1111-1111-111111111111'

describe('tenders routes', () => {
  afterEach(() => {
    __resetSupabaseAdminForTests()
  })

  it('requires authentication on every tenders route, including every sub-resource', async () => {
    const app = await buildApp()
    for (const url of [
      '/api/tenders',
      '/api/tenders/summary',
      `/api/tenders/${tenderId}`,
      `/api/tenders/${tenderId}/requirements`,
      `/api/tenders/${tenderId}/evaluation`,
      `/api/tenders/${tenderId}/documents`,
      `/api/tenders/${tenderId}/addenda`,
      `/api/tenders/${tenderId}/briefing`,
      `/api/tenders/${tenderId}/score`,
      `/api/tenders/${tenderId}/risks`,
      `/api/tenders/${tenderId}/activity`,
    ]) {
      const response = await app.inject({ method: 'GET', url })
      expect(response.statusCode, `${url} should require auth`).toBe(401)
    }
    await app.close()
  })

  it('requires authentication on watchlist and saved-filter routes', async () => {
    const app = await buildApp()
    const getRoutes = ['/api/watchlist', '/api/saved-filters']
    for (const url of getRoutes) {
      const response = await app.inject({ method: 'GET', url })
      expect(response.statusCode, `${url} should require auth`).toBe(401)
    }
    const post = await app.inject({ method: 'POST', url: '/api/watchlist', payload: { tenderId } })
    expect(post.statusCode).toBe(401)
    const del = await app.inject({ method: 'DELETE', url: `/api/watchlist/${tenderId}` })
    expect(del.statusCode).toBe(401)
    await app.close()
  })

  it('degrades to 503 rather than crashing when Supabase is not configured', async () => {
    const app = await buildApp()
    const response = await app.inject({
      method: 'GET',
      url: '/api/tenders/summary',
      headers: { authorization: 'Bearer not-a-real-token' },
    })
    expect(response.statusCode).toBe(503)
    await app.close()
  })
})

describe('tenderListQuerySchema (Phase 3 §20 query parameter validation)', () => {
  it('defaults page to 1 and pageSize to 25', () => {
    const parsed = tenderListQuerySchema.parse({})
    expect(parsed.page).toBe(1)
    expect(parsed.pageSize).toBe(25)
  })

  it('rejects a pageSize above the 100 cap', () => {
    expect(() => tenderListQuerySchema.parse({ pageSize: '500' })).toThrow()
  })

  it('rejects a status value outside the tender_status enum', () => {
    expect(() => tenderListQuerySchema.parse({ status: 'DEFINITELY_NOT_A_STATUS' })).toThrow()
  })

  it('accepts every real tender_status value', () => {
    for (const status of ['DISCOVERED', 'OPEN', 'CLOSING_SOON', 'CLOSED', 'AWARDED']) {
      expect(() => tenderListQuerySchema.parse({ status })).not.toThrow()
    }
  })

  it('rejects a sort column that is not on the allow-list (Phase 3 §20: "safe allow-listed sorting")', () => {
    expect(() => tenderListQuerySchema.parse({ sort: 'organisation; drop table tenders;' })).toThrow()
  })

  it('accepts every allow-listed sort column', () => {
    for (const sort of ['closing_date', 'published_date', 'discovered_at', 'title', 'estimated_value', 'status']) {
      expect(() => tenderListQuerySchema.parse({ sort })).not.toThrow()
    }
  })

  it('rejects a malformed date for closingBefore/closingAfter', () => {
    expect(() => tenderListQuerySchema.parse({ closingBefore: 'not-a-date' })).toThrow()
  })

  it('rejects a non-uuid service or source id', () => {
    expect(() => tenderListQuerySchema.parse({ service: 'not-a-uuid' })).toThrow()
    expect(() => tenderListQuerySchema.parse({ source: 'not-a-uuid' })).toThrow()
  })

  it('coerces the briefingRequired string query param to a real boolean', () => {
    expect(tenderListQuerySchema.parse({ briefingRequired: 'true' }).briefingRequired).toBe(true)
  })

  it('parses the literal string "false" as false, not truthy (a common z.coerce.boolean() pitfall)', () => {
    expect(tenderListQuerySchema.parse({ briefingRequired: 'false' }).briefingRequired).toBe(false)
  })
})
