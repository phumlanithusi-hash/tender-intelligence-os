/**
 * Generic API envelope types used across every endpoint (spec §40).
 * Kept intentionally small in Phase 1 — domain-specific response
 * shapes are added alongside the endpoints that need them in later
 * phases, validated against shared Zod schemas (@tender-os/schemas).
 */
export interface ApiError {
  error: {
    code: string
    message: string
    details?: unknown
  }
}

export interface ApiSuccess<T> {
  data: T
}

export type ApiResult<T> = ApiSuccess<T> | ApiError

export interface HealthCheckResponse {
  status: 'ok' | 'degraded'
  service: string
  timestamp: string
  checks: {
    database: 'ok' | 'error' | 'not_configured'
  }
}

/**
 * Async UI state discriminated union — every data-fetching hook in
 * apps/web must be representable by this shape so loading/empty/
 * error/success are never implicit (spec §10, build execution §6).
 */
export type AsyncState<T> =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'empty' }
  | { status: 'success'; data: T }
