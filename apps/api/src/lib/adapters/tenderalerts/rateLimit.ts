/** Conservative throttling configuration — same shape/defaults as every other adapter's rateLimit.ts. This adapter pages through ~60-70 pages per full discovery pass, so a real delay between pages matters here more than for single-fetch adapters. */
export interface TenderAlertsRateLimitConfig {
  concurrency: number
  delayMs: number
  timeoutMs: number
  maxRetries: number
}

export const DEFAULT_TENDERALERTS_RATE_LIMIT: TenderAlertsRateLimitConfig = {
  concurrency: 1,
  delayMs: 1500,
  timeoutMs: 45_000,
  maxRetries: 3,
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
