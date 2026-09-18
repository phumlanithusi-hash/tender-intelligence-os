import { describe, expect, it } from 'vitest'
import { buildApp } from '../../app.js'

describe('/api/me', () => {
  it('requires authentication', async () => {
    const app = await buildApp()
    const response = await app.inject({ method: 'GET', url: '/api/me' })
    expect(response.statusCode).toBe(401)
    await app.close()
  })
})
