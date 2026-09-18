import { logger } from '../logger.js'

/**
 * Phase 19 gap-closing (spec §23) — a single, structured shape for
 * operation-level logs so every call site emits the same fields
 * rather than each route inventing its own log shape: timestamp
 * (added automatically by pino), request id, agency id, user id,
 * entity id, operation, status, duration (ms), and — on failure — an
 * error classification. Never logs a request/response body, a
 * header, or any field on `lib/logger.ts`'s redact list (secrets are
 * redacted centrally there, not re-checked per call site).
 */
export interface OperationLogFields {
  requestId: string
  agencyId: string | null
  userId: string | null
  entityId: string | null
  operation: string
  status: 'SUCCESS' | 'FAILURE'
  durationMs: number
  errorClass?: string
}

export function logOperation(fields: OperationLogFields): void {
  const log = fields.status === 'SUCCESS' ? logger.info.bind(logger) : logger.error.bind(logger)
  log(
    {
      requestId: fields.requestId,
      agencyId: fields.agencyId,
      userId: fields.userId,
      entityId: fields.entityId,
      operation: fields.operation,
      status: fields.status,
      durationMs: fields.durationMs,
      errorClass: fields.errorClass ?? null,
    },
    `${fields.operation}: ${fields.status.toLowerCase()}`,
  )
}

/** Wraps an async operation, timing it and logging a SUCCESS/FAILURE row with the required fields — never swallows the error, only observes it. */
export async function withOperationLog<T>(
  base: Omit<OperationLogFields, 'status' | 'durationMs' | 'errorClass'>,
  fn: () => Promise<T>,
): Promise<T> {
  const start = Date.now()
  try {
    const result = await fn()
    logOperation({ ...base, status: 'SUCCESS', durationMs: Date.now() - start })
    return result
  } catch (error) {
    logOperation({
      ...base,
      status: 'FAILURE',
      durationMs: Date.now() - start,
      errorClass: error instanceof Error ? error.constructor.name : 'UnknownError',
    })
    throw error
  }
}
