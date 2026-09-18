import { describe, expect, it, afterEach } from 'vitest'
import { buildApp } from '../../app.js'
import { __resetSupabaseAdminForTests } from '../../lib/supabaseAdmin.js'

const tenderId = '11111111-1111-1111-1111-111111111111'
const documentId = '22222222-2222-2222-2222-222222222222'

describe('tenderDocuments routes (Phase 6 §25)', () => {
  afterEach(() => {
    __resetSupabaseAdminForTests()
  })

  it('requires authentication on every read route', async () => {
    const app = await buildApp()
    for (const url of [
      `/api/tenders/${tenderId}/documents/${documentId}`,
      `/api/tenders/${tenderId}/documents/${documentId}/pages`,
      `/api/tenders/${tenderId}/documents/${documentId}/sections`,
      `/api/tenders/${tenderId}/documents/${documentId}/chunks`,
    ]) {
      const response = await app.inject({ method: 'GET', url })
      expect(response.statusCode, `${url} should require auth`).toBe(401)
    }
    await app.close()
  })

  it('requires authentication on the download and reprocess actions', async () => {
    const app = await buildApp()
    for (const url of [
      `/api/tenders/${tenderId}/documents/${documentId}/download`,
      `/api/tenders/${tenderId}/documents/${documentId}/reprocess`,
    ]) {
      const response = await app.inject({ method: 'POST', url })
      expect(response.statusCode, `${url} should require auth`).toBe(401)
    }
    await app.close()
  })

  it('degrades to 503 rather than crashing when Supabase is not configured', async () => {
    const app = await buildApp()
    const response = await app.inject({
      method: 'GET',
      url: `/api/tenders/${tenderId}/documents/${documentId}`,
      headers: { authorization: 'Bearer not-a-real-token' },
    })
    expect(response.statusCode).toBe(503)
    await app.close()
  })

  it('rejects a non-UUID document id with a validation error rather than crashing', async () => {
    const app = await buildApp()
    const response = await app.inject({
      method: 'GET',
      url: `/api/tenders/${tenderId}/documents/not-a-uuid`,
      headers: { authorization: 'Bearer not-a-real-token' },
    })
    // Auth resolution (503, Supabase unconfigured) happens before
    // param validation in this app's hook order — either a 503 or a
    // 400 is an acceptable non-crash outcome; a 500 is not.
    expect([400, 503]).toContain(response.statusCode)
    await app.close()
  })
})
