/**
 * AI error taxonomy (Phase 7 §5/§21/§27). Distinguishing these matters
 * for retry policy: only `AiProviderError` with `retryable: true` is
 * ever retried (timeout/429/5xx). Schema/evidence/input errors are
 * never retried — the model producing the same malformed shape again
 * would just waste another call.
 */

export class AiProviderError extends Error {
  readonly retryable: boolean
  readonly kind: 'TIMEOUT' | 'RATE_LIMIT' | 'SERVER_ERROR' | 'UNKNOWN'

  constructor(message: string, kind: AiProviderError['kind'], retryable: boolean) {
    super(message)
    this.name = 'AiProviderError'
    this.kind = kind
    this.retryable = retryable
  }
}

/** Raw model output was not valid JSON at all. */
export class AiMalformedOutputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AiMalformedOutputError'
  }
}

/** JSON parsed, but failed Zod schema validation. */
export class AiSchemaValidationError extends Error {
  readonly issues: string[]
  constructor(message: string, issues: string[]) {
    super(message)
    this.name = 'AiSchemaValidationError'
    this.issues = issues
  }
}

/** A claimed evidence reference could not be resolved against real stored data (Phase 7 §16). */
export class AiEvidenceValidationError extends Error {
  readonly issues: string[]
  constructor(message: string, issues: string[]) {
    super(message)
    this.name = 'AiEvidenceValidationError'
    this.issues = issues
  }
}

/** Idempotency guard (Phase 7 §22/§36): a QUEUED/RUNNING run already exists for this tender+agency. */
export class AiRunAlreadyActiveError extends Error {
  readonly existingRunId: string
  constructor(existingRunId: string) {
    super(`An AI classification run is already active for this tender (run ${existingRunId}).`)
    this.name = 'AiRunAlreadyActiveError'
    this.existingRunId = existingRunId
  }
}

export class AiNotConfiguredError extends Error {
  constructor(message = 'OPENAI_API_KEY is not configured.') {
    super(message)
    this.name = 'AiNotConfiguredError'
  }
}
