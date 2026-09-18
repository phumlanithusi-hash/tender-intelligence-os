import { AiProviderError } from '../errors.js'

export interface RetryOptions {
  maxRetries: number
  /** Injectable for tests — never real timers in the unit suite. */
  sleep?: (ms: number) => Promise<void>
  baseDelayMs?: number
}

/**
 * Bounded retry with exponential backoff — ONLY for transient
 * provider failures (Phase 7 §27: timeout/429/5xx). Schema failures,
 * evidence validation failures, and any other error type propagate
 * immediately with zero retries, since retrying a deterministic
 * malformed-output case would just waste another call for the same
 * result.
 */
export async function withProviderRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<{ result: T; retries: number }> {
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))
  const baseDelayMs = options.baseDelayMs ?? 200

  let attempt = 0
  for (;;) {
    try {
      const result = await fn()
      return { result, retries: attempt }
    } catch (err) {
      const retryable = err instanceof AiProviderError && err.retryable
      if (!retryable || attempt >= options.maxRetries) {
        throw err
      }
      attempt += 1
      await sleep(baseDelayMs * 2 ** (attempt - 1))
    }
  }
}
