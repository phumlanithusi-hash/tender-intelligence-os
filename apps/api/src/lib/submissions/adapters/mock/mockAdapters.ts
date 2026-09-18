import type { AdapterExecutionRequest, AdapterExecutionResult, SubmissionAdapter } from '../types.js'

/**
 * Phase 16 §48/§49 — TEST/MOCK ONLY adapters. Never wired into any
 * production code path (nothing in routes/submissionExecution.ts or
 * supabaseSubmissionExecutionStore.ts imports this file) — used
 * exclusively by lib/submissions/__tests__ to exercise every terminal
 * adapter outcome deterministically. The default runtime adapter
 * registry (buildDefaultAdapterRegistry in registry.ts) never includes
 * these; it uses the real manual/email/portal/api/physical adapters,
 * which themselves degrade to MANUAL_REQUIRED in every environment
 * this build ships (no live provider is configured — §48/§49's
 * explicit "never send a real tender accidentally" requirement).
 */

export const MockPortalSuccessAdapter: SubmissionAdapter = {
  method: 'PORTAL',
  canHandle: () => true,
  validate: () => ({ valid: true, errorCode: null, errorMessage: null }),
  async execute(request: AdapterExecutionRequest): Promise<AdapterExecutionResult> {
    return { outcome: 'SUCCEEDED', providerName: 'MOCK_PORTAL', providerReference: `MOCK-REF-${request.idempotencyKey.slice(0, 8)}`, externalSubmissionId: `mock-${request.packId}`, responseStatus: 'SUCCESS', responseCode: '200', errorCode: null, errorMessage: null }
  },
}

export const MockPortalTimeoutAdapter: SubmissionAdapter = {
  method: 'PORTAL',
  canHandle: () => true,
  validate: () => ({ valid: true, errorCode: null, errorMessage: null }),
  async execute(): Promise<AdapterExecutionResult> {
    return { outcome: 'UNKNOWN_OUTCOME', providerName: 'MOCK_PORTAL', providerReference: null, externalSubmissionId: null, responseStatus: null, responseCode: null, errorCode: 'TIMEOUT', errorMessage: 'MOCK: the request timed out; provider receipt unknown.' }
  },
}

export const MockPortalCaptchaAdapter: SubmissionAdapter = {
  method: 'PORTAL',
  canHandle: () => true,
  validate: () => ({ valid: true, errorCode: null, errorMessage: null }),
  async execute(): Promise<AdapterExecutionResult> {
    return { outcome: 'REQUIRES_MANUAL_ACTION', providerName: 'MOCK_PORTAL', providerReference: null, externalSubmissionId: null, responseStatus: null, responseCode: null, errorCode: 'CAPTCHA_REQUIRED', errorMessage: 'MOCK: the portal presented a CAPTCHA.' }
  },
}

export const MockPortalRejectedAdapter: SubmissionAdapter = {
  method: 'PORTAL',
  canHandle: () => true,
  validate: () => ({ valid: true, errorCode: null, errorMessage: null }),
  async execute(): Promise<AdapterExecutionResult> {
    return { outcome: 'FAILED', providerName: 'MOCK_PORTAL', providerReference: null, externalSubmissionId: null, responseStatus: 'REJECTED', responseCode: '422', errorCode: 'PROVIDER_REJECTED', errorMessage: 'MOCK: the provider rejected the submission (e.g. malformed pack).' }
  },
}

export const MockEmailAdapter: SubmissionAdapter = {
  method: 'EMAIL',
  canHandle: () => true,
  validate: () => ({ valid: true, errorCode: null, errorMessage: null }),
  async execute(request: AdapterExecutionRequest): Promise<AdapterExecutionResult> {
    return { outcome: 'SUCCEEDED', providerName: 'MOCK_EMAIL', providerReference: `mock-message-id-${request.idempotencyKey.slice(0, 8)}`, externalSubmissionId: null, responseStatus: 'SENT', responseCode: null, errorCode: null, errorMessage: null }
  },
}

export const MockPhysicalAdapter: SubmissionAdapter = {
  method: 'PHYSICAL_COURIER',
  canHandle: () => true,
  validate: () => ({ valid: true, errorCode: null, errorMessage: null }),
  async execute(): Promise<AdapterExecutionResult> {
    return { outcome: 'REQUIRES_MANUAL_ACTION', providerName: null, providerReference: null, externalSubmissionId: null, responseStatus: null, responseCode: null, errorCode: 'MANUAL_ACTION_REQUIRED', errorMessage: 'MOCK: physical dispatch is always a manual, human-executed workflow.' }
  },
}
