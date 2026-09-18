import { describe, expect, it } from 'vitest'
import { clientEnvSchema } from './clientEnv.js'

describe('clientEnvSchema', () => {
  it('requires a Supabase URL and anon key', () => {
    const result = clientEnvSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('never accepts a service-role-shaped key field', () => {
    // The schema simply has no field for it — this test documents that
    // intent so a future edit that adds one is caught in review.
    const keys = Object.keys(clientEnvSchema.shape)
    expect(keys.some((k) => k.toLowerCase().includes('service_role'))).toBe(false)
  })
})
