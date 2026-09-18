import { describe, it, expect, vi } from 'vitest'
import { withProviderRetry } from '../execution/retry.js'
import { AiProviderError, AiSchemaValidationError } from '../errors.js'

describe('withProviderRetry (Phase 7 §27)', () => {
  it('retries a retryable provider error up to maxRetries, then succeeds', async () => {
    let calls = 0
    const fn = vi.fn(async () => {
      calls += 1
      if (calls < 3) throw new AiProviderError('timeout', 'TIMEOUT', true)
      return 'ok'
    })
    const { result, retries } = await withProviderRetry(fn, { maxRetries: 3, sleep: async () => {} })
    expect(result).toBe('ok')
    expect(retries).toBe(2)
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('gives up after exhausting maxRetries', async () => {
    const fn = vi.fn(async () => {
      throw new AiProviderError('down', 'SERVER_ERROR', true)
    })
    await expect(withProviderRetry(fn, { maxRetries: 2, sleep: async () => {} })).rejects.toThrow('down')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('never retries a non-retryable error (e.g. schema validation failure)', async () => {
    const fn = vi.fn(async () => {
      throw new AiSchemaValidationError('bad shape', ['x'])
    })
    await expect(withProviderRetry(fn, { maxRetries: 5, sleep: async () => {} })).rejects.toThrow(AiSchemaValidationError)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('never retries an AiProviderError explicitly marked non-retryable', async () => {
    const fn = vi.fn(async () => {
      throw new AiProviderError('bad request', 'UNKNOWN', false)
    })
    await expect(withProviderRetry(fn, { maxRetries: 5, sleep: async () => {} })).rejects.toThrow('bad request')
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
