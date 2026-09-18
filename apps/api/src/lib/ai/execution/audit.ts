import { logger } from '../../logger.js'

/**
 * AI observability events (Phase 7 §39). Deliberately logs only IDs
 * and small summary fields — never full extracted document text, and
 * never API keys/credentials (the OpenAI client never receives a
 * logger reference at all).
 */
export function logAiRunStarted(fields: { runId: string; tenderId: string; agencyId: string | null; model: string }): void {
  logger.info({ event: 'AI_RUN_STARTED', ...fields }, 'AI classification run started')
}
export function logAiRunCompleted(fields: { runId: string; tenderId: string; status: string; durationMs: number | null }): void {
  logger.info({ event: 'AI_RUN_COMPLETED', ...fields }, 'AI classification run completed')
}
export function logAiRunFailed(fields: { runId: string; tenderId: string; errorStage: string; error: string }): void {
  logger.warn({ event: 'AI_RUN_FAILED', ...fields }, 'AI classification run failed')
}
export function logAiSchemaInvalid(fields: { runId: string; tenderId: string; issues: string[] }): void {
  logger.warn({ event: 'AI_SCHEMA_INVALID', ...fields }, 'AI output failed schema validation')
}
export function logAiEvidenceInvalid(fields: { runId: string; tenderId: string; issues: string[] }): void {
  logger.warn({ event: 'AI_EVIDENCE_INVALID', ...fields }, 'AI evidence failed validation')
}
export function logAiRequiresReview(fields: { runId: string; tenderId: string; reason: string }): void {
  logger.warn({ event: 'AI_REQUIRES_REVIEW', ...fields }, 'AI run requires human review')
}
