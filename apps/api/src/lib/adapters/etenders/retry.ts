import type { SourceErrorType } from '@tender-os/constants'

/**
 * Retry classification (Phase 5 §15): decides, from a raised error
 * alone, whether a retry is safe and how it maps onto
 * `tender_source_errors.error_type`. Pure and synchronous so it can
 * be unit-tested without ever needing a real network failure.
 *
 * Safe to retry: network timeout, temporary server error (5xx),
 * rate limiting (uses Retry-After when present). NOT safe to retry:
 * authentication failures, access denied (401/403), persistent
 * parsing errors, blocked access.
 */
export interface ClassifiedError {
  errorType: SourceErrorType
  retryable: boolean
  /** Suggested delay before the next attempt, in ms — respects Retry-After when the source provided one. */
  suggestedDelayMs: number | null
}

export interface ErrorLike {
  message?: string
  code?: string
  statusCode?: number
  retryAfterSeconds?: number
}

export function classifyError(err: unknown): ClassifiedError {
  const e = toErrorLike(err)
  const status = e.statusCode

  if (e.code === 'ETIMEDOUT' || e.code === 'ESOCKETTIMEDOUT' || /timeout/i.test(e.message ?? '')) {
    return { errorType: 'TIMEOUT', retryable: true, suggestedDelayMs: null }
  }

  if (
    e.code === 'ECONNRESET' ||
    e.code === 'ECONNREFUSED' ||
    e.code === 'ENOTFOUND' ||
    e.code === 'EAI_AGAIN' ||
    /network|dns|connect/i.test(e.message ?? '')
  ) {
    return { errorType: 'NETWORK', retryable: true, suggestedDelayMs: null }
  }

  if (status === 429) {
    return {
      errorType: 'RATE_LIMIT',
      retryable: true,
      suggestedDelayMs: e.retryAfterSeconds !== undefined ? e.retryAfterSeconds * 1000 : 5000,
    }
  }

  if (status === 401 || status === 403) {
    return { errorType: 'AUTHENTICATION', retryable: false, suggestedDelayMs: null }
  }

  if (status !== undefined && status >= 500) {
    return { errorType: 'HTTP', retryable: true, suggestedDelayMs: null }
  }

  if (status !== undefined && status >= 400) {
    // Other 4xx (404, 400, etc.) is a persistent client-side problem
    // with this specific request, not a transient one — retrying the
    // exact same request will not succeed.
    return { errorType: 'HTTP', retryable: false, suggestedDelayMs: null }
  }

  if (/parse|unexpected token|selector not found|element not found/i.test(e.message ?? '')) {
    return { errorType: 'PARSING', retryable: false, suggestedDelayMs: null }
  }

  return { errorType: 'UNKNOWN', retryable: false, suggestedDelayMs: null }
}

function toErrorLike(err: unknown): ErrorLike {
  if (err && typeof err === 'object') {
    const obj = err as Record<string, unknown>
    return {
      message: typeof obj.message === 'string' ? obj.message : undefined,
      code: typeof obj.code === 'string' ? obj.code : undefined,
      statusCode: typeof obj.statusCode === 'number' ? obj.statusCode : undefined,
      retryAfterSeconds: typeof obj.retryAfterSeconds === 'number' ? obj.retryAfterSeconds : undefined,
    }
  }
  return { message: String(err) }
}

/** Exponential backoff with a cap, deterministic given `attempt` (no jitter, so it is easy to unit-test) — a thin wrapper only ever used when `classifyError` says a retry is safe. */
export function computeBackoffMs(attempt: number, baseMs = 1000, maxMs = 30_000): number {
  const delay = baseMs * 2 ** Math.max(0, attempt - 1)
  return Math.min(delay, maxMs)
}
