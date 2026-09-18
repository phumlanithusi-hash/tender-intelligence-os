import { logger } from '../logger.js'

/** Observability events for qualification runs (Phase 8, mirrors ai/execution/audit.ts). Never logs full agency evidence text, only ids/counts. */
export function logQualificationRunStarted(fields: { runId: string; tenderId: string; agencyId: string }): void {
  logger.info({ event: 'QUALIFICATION_RUN_STARTED', ...fields }, 'Qualification evaluation run started')
}
export function logQualificationRunCompleted(fields: { runId: string; tenderId: string; overallStatus: string }): void {
  logger.info({ event: 'QUALIFICATION_RUN_COMPLETED', ...fields }, 'Qualification evaluation run completed')
}
export function logQualificationRunFailed(fields: { runId: string; tenderId: string; error: string }): void {
  logger.warn({ event: 'QUALIFICATION_RUN_FAILED', ...fields }, 'Qualification evaluation run failed')
}
export function logQualificationMandatoryBlocker(fields: { runId: string; tenderId: string; agencyId: string; count: number }): void {
  logger.warn({ event: 'QUALIFICATION_MANDATORY_BLOCKER', ...fields }, 'Qualification run found mandatory blocker(s)')
}
