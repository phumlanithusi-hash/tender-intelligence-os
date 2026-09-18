import type { SubmissionErrorCode } from '@tender-os/constants'

/**
 * Phase 16 §24 — structured error classification. Every code carries a
 * FIXED, deterministic (retryable, humanActionRequired) verdict — an
 * adapter never invents its own retry policy per error.
 */
export interface ErrorClassification {
  code: SubmissionErrorCode
  retryable: boolean
  humanActionRequired: boolean
}

const CLASSIFICATIONS: Record<SubmissionErrorCode, ErrorClassification> = {
  AUTHENTICATION_REQUIRED: { code: 'AUTHENTICATION_REQUIRED', retryable: false, humanActionRequired: true },
  AUTHORIZATION_FAILED: { code: 'AUTHORIZATION_FAILED', retryable: false, humanActionRequired: true },
  CAPTCHA_REQUIRED: { code: 'CAPTCHA_REQUIRED', retryable: false, humanActionRequired: true },
  MFA_REQUIRED: { code: 'MFA_REQUIRED', retryable: false, humanActionRequired: true },
  PORTAL_UNAVAILABLE: { code: 'PORTAL_UNAVAILABLE', retryable: true, humanActionRequired: false },
  NETWORK_ERROR: { code: 'NETWORK_ERROR', retryable: true, humanActionRequired: false },
  TIMEOUT: { code: 'TIMEOUT', retryable: false, humanActionRequired: true }, // outcome unknown — never auto-retried (§23)
  DEADLINE_PASSED: { code: 'DEADLINE_PASSED', retryable: false, humanActionRequired: false },
  PACK_CHANGED: { code: 'PACK_CHANGED', retryable: false, humanActionRequired: true },
  READINESS_INVALID: { code: 'READINESS_INVALID', retryable: false, humanActionRequired: true },
  TARGET_INVALID: { code: 'TARGET_INVALID', retryable: false, humanActionRequired: true },
  ATTACHMENT_INVALID: { code: 'ATTACHMENT_INVALID', retryable: false, humanActionRequired: true },
  PROVIDER_REJECTED: { code: 'PROVIDER_REJECTED', retryable: false, humanActionRequired: true },
  DUPLICATE_RISK: { code: 'DUPLICATE_RISK', retryable: false, humanActionRequired: true },
  UNKNOWN_PROVIDER_RESULT: { code: 'UNKNOWN_PROVIDER_RESULT', retryable: false, humanActionRequired: true },
  MANUAL_ACTION_REQUIRED: { code: 'MANUAL_ACTION_REQUIRED', retryable: false, humanActionRequired: true },
  UNSUPPORTED_METHOD: { code: 'UNSUPPORTED_METHOD', retryable: false, humanActionRequired: true },
  UNKNOWN: { code: 'UNKNOWN', retryable: false, humanActionRequired: true },
}

export function classifyError(code: SubmissionErrorCode): ErrorClassification {
  return CLASSIFICATIONS[code]
}
