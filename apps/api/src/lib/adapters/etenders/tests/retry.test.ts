import { describe, expect, it } from 'vitest'
import { classifyError, computeBackoffMs } from '../retry.js'

describe('classifyError (Phase 5 §15)', () => {
  it('timeouts are retryable', () => {
    expect(classifyError({ code: 'ETIMEDOUT' }).retryable).toBe(true)
    expect(classifyError(new Error('Navigation timeout exceeded')).errorType).toBe('TIMEOUT')
  })

  it('network errors are retryable', () => {
    expect(classifyError({ code: 'ECONNRESET' })).toMatchObject({ errorType: 'NETWORK', retryable: true })
    expect(classifyError({ code: 'ENOTFOUND' })).toMatchObject({ errorType: 'NETWORK', retryable: true })
  })

  it('429 rate limiting is retryable and respects Retry-After', () => {
    const result = classifyError({ statusCode: 429, retryAfterSeconds: 10 })
    expect(result).toEqual({ errorType: 'RATE_LIMIT', retryable: true, suggestedDelayMs: 10_000 })
  })

  it('429 without Retry-After still gets a conservative default delay', () => {
    const result = classifyError({ statusCode: 429 })
    expect(result.retryable).toBe(true)
    expect(result.suggestedDelayMs).toBeGreaterThan(0)
  })

  it('401/403 are NOT retryable (authentication/access denied)', () => {
    expect(classifyError({ statusCode: 401 })).toMatchObject({ errorType: 'AUTHENTICATION', retryable: false })
    expect(classifyError({ statusCode: 403 })).toMatchObject({ errorType: 'AUTHENTICATION', retryable: false })
  })

  it('5xx is retryable', () => {
    expect(classifyError({ statusCode: 503 })).toMatchObject({ errorType: 'HTTP', retryable: true })
  })

  it('other 4xx is not retryable (persistent client-side problem)', () => {
    expect(classifyError({ statusCode: 404 })).toMatchObject({ errorType: 'HTTP', retryable: false })
  })

  it('a parsing failure is not retryable', () => {
    expect(classifyError(new Error('selector not found: table tbody tr'))).toMatchObject({
      errorType: 'PARSING',
      retryable: false,
    })
  })

  it('unknown errors are not retryable by default (conservative)', () => {
    expect(classifyError(new Error('totally unexpected'))).toMatchObject({ errorType: 'UNKNOWN', retryable: false })
  })
})

describe('computeBackoffMs', () => {
  it('doubles each attempt and caps at maxMs', () => {
    expect(computeBackoffMs(1, 1000, 30_000)).toBe(1000)
    expect(computeBackoffMs(2, 1000, 30_000)).toBe(2000)
    expect(computeBackoffMs(3, 1000, 30_000)).toBe(4000)
    expect(computeBackoffMs(10, 1000, 30_000)).toBe(30_000)
  })
})
