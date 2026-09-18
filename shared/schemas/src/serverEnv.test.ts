import { describe, expect, it } from 'vitest'
import { serverEnvSchema } from './serverEnv.js'

describe('serverEnvSchema', () => {
  it('applies sensible defaults with no env vars set', () => {
    const result = serverEnvSchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.NODE_ENV).toBe('development')
      expect(result.data.OPENAI_EMBEDDING_MODEL).toBe('text-embedding-3-small')
    }
  })

  it('rejects an invalid NODE_ENV', () => {
    const result = serverEnvSchema.safeParse({ NODE_ENV: 'staging-typo' })
    expect(result.success).toBe(false)
  })
})
