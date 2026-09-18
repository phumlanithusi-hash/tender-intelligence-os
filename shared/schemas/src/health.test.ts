import { describe, expect, it } from 'vitest'
import { healthCheckResponseSchema } from './health.js'

describe('healthCheckResponseSchema', () => {
  it('accepts a valid ok response', () => {
    const result = healthCheckResponseSchema.safeParse({
      status: 'ok',
      service: 'api',
      timestamp: new Date().toISOString(),
      checks: { database: 'ok' },
    })
    expect(result.success).toBe(true)
  })

  it('rejects an invalid status value', () => {
    const result = healthCheckResponseSchema.safeParse({
      status: 'fabricated-status',
      service: 'api',
      timestamp: new Date().toISOString(),
      checks: { database: 'ok' },
    })
    expect(result.success).toBe(false)
  })

  it('rejects a missing checks object', () => {
    const result = healthCheckResponseSchema.safeParse({
      status: 'ok',
      service: 'api',
      timestamp: new Date().toISOString(),
    })
    expect(result.success).toBe(false)
  })
})
