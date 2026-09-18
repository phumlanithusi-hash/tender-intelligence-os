import type { SubmissionErrorCode, SubmissionExecutionMethod } from '@tender-os/constants'

/**
 * Phase 16 §13/§14 — the SubmissionAdapter contract. The core
 * orchestration engine (runSubmission.ts) is never coupled to one
 * portal/provider — every method (portal/email/physical/api/manual)
 * implements this same shape. `execute` NEVER runs without an already
 * -validated, human-confirmed attempt (the orchestration layer
 * enforces that before ever calling an adapter) and NEVER bypasses a
 * CAPTCHA/MFA/anti-bot control — encountering one always resolves to
 * REQUIRES_MANUAL_ACTION (§4/§14 binding constraint).
 */
export interface AdapterExecutionRequest {
  method: SubmissionExecutionMethod
  target: string | null
  packId: string
  packVersion: number
  packHash: string
  manifestHash: string
  files: Array<{ fileName: string; sizeBytes: number | null; sha256: string; mimeType: string | null }>
  confirmationId: string
  idempotencyKey: string
}

export interface AdapterExecutionResult {
  outcome: 'SUCCEEDED' | 'FAILED' | 'UNKNOWN_OUTCOME' | 'REQUIRES_MANUAL_ACTION'
  providerName: string | null
  providerReference: string | null
  externalSubmissionId: string | null
  responseStatus: string | null
  responseCode: string | null
  errorCode: SubmissionErrorCode | null
  errorMessage: string | null
}

export interface SubmissionAdapter {
  method: SubmissionExecutionMethod
  /** True when this adapter can meaningfully act on the given request (right method, right shape of target). */
  canHandle(request: AdapterExecutionRequest): boolean
  /** Deterministic pre-flight the adapter itself is responsible for (e.g. attachment integrity for email) — never network I/O. */
  validate(request: AdapterExecutionRequest): { valid: boolean; errorCode: SubmissionErrorCode | null; errorMessage: string | null }
  /** Performs (or simulates, for mock/manual adapters) the submission attempt. Only ever called after human confirmation + validate() passed. */
  execute(request: AdapterExecutionRequest): Promise<AdapterExecutionResult>
}
