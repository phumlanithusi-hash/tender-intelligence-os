/**
 * Conservative throttling configuration and a tiny sequential runner
 * (Phase 5 §16: "Conservative throttling, no uncontrolled parallel
 * requests. Configurable concurrency/delay/timeout/retry count,
 * conservative defaults."). This adapter never fans out concurrent
 * requests against eTenders — `concurrency` exists as a documented
 * knob for the future, but the default (and everything this phase
 * actually calls) is concurrency 1, i.e. one request in flight at a
 * time with a delay between each.
 */
export interface EtendersRateLimitConfig {
  /** Requests in flight at once. Default 1 — sequential only (Phase 5 §16). */
  concurrency: number
  /** Minimum delay between consecutive requests, ms. */
  delayMs: number
  /** Per-request timeout, ms. */
  timeoutMs: number
  /** Max attempts per request (1 = no retry) before giving up and recording a failure. */
  maxRetries: number
}

export const DEFAULT_ETENDERS_RATE_LIMIT: EtendersRateLimitConfig = {
  concurrency: 1,
  delayMs: 1500,
  timeoutMs: 20_000,
  maxRetries: 3,
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Runs `items` through `fn` one at a time (Phase 5 §16's concurrency-1
 * default), waiting `delayMs` between each — never firing the next
 * request until the previous one has settled. `fn` throwing does not
 * stop the run; the caller receives every outcome (success or error)
 * so a single malformed item can never abort the whole batch (Phase 5
 * §14).
 */
export async function throttledMap<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  config: Pick<EtendersRateLimitConfig, 'delayMs'> = DEFAULT_ETENDERS_RATE_LIMIT,
): Promise<Array<{ item: T; result?: R; error?: unknown }>> {
  const results: Array<{ item: T; result?: R; error?: unknown }> = []
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]!
    try {
      const result = await fn(item, i)
      results.push({ item, result })
    } catch (error) {
      results.push({ item, error })
    }
    if (i < items.length - 1 && config.delayMs > 0) {
      await sleep(config.delayMs)
    }
  }
  return results
}
