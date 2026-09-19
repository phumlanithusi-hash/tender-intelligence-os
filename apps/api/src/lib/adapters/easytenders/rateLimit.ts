/**
 * Conservative throttling configuration — same shape and defaults as
 * adapters/etenders/rateLimit.ts, duplicated here (rather than shared)
 * to keep each adapter directory self-contained per this codebase's
 * own stated boundary rule.
 */
export interface EasyTendersRateLimitConfig {
  concurrency: number
  delayMs: number
  timeoutMs: number
  maxRetries: number
}

export const DEFAULT_EASYTENDERS_RATE_LIMIT: EasyTendersRateLimitConfig = {
  concurrency: 1,
  delayMs: 1500,
  timeoutMs: 20_000,
  maxRetries: 3,
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
