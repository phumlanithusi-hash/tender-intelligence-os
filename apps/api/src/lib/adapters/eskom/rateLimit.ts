/** Conservative throttling configuration — same shape/defaults as every other adapter's rateLimit.ts. */
export interface EskomRateLimitConfig {
  concurrency: number
  delayMs: number
  timeoutMs: number
  maxRetries: number
}

export const DEFAULT_ESKOM_RATE_LIMIT: EskomRateLimitConfig = {
  concurrency: 1,
  delayMs: 1500,
  timeoutMs: 45_000,
  maxRetries: 3,
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
