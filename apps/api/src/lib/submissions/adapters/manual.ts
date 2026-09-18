import type { AdapterExecutionRequest, AdapterExecutionResult, SubmissionAdapter } from './types.js'

/**
 * Phase 16 §18 — MANUAL SUBMISSION MODE. The first-class path for any
 * method that isn't (or shouldn't be) automated. `execute()` never
 * contacts anything external — it always resolves to
 * REQUIRES_MANUAL_ACTION, carrying the numbered instructions a human
 * must follow, and the human separately records completion via the
 * manual-complete endpoint (routes/submissionExecution.ts) — which
 * itself only ever produces SUBMISSION_REPORTED, never SUBMITTED
 * (§18/§62 binding constraint).
 */
export function createManualAdapter(instructions: string[]): SubmissionAdapter {
  return {
    method: 'OTHER',
    canHandle: () => true,
    validate: () => ({ valid: true, errorCode: null, errorMessage: null }),
    async execute(_request: AdapterExecutionRequest): Promise<AdapterExecutionResult> {
      return {
        outcome: 'REQUIRES_MANUAL_ACTION',
        providerName: null,
        providerReference: null,
        externalSubmissionId: null,
        responseStatus: null,
        responseCode: null,
        errorCode: 'MANUAL_ACTION_REQUIRED',
        errorMessage: instructions.join(' '),
      }
    },
  }
}
