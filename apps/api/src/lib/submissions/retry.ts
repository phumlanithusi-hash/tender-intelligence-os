import type { RetryDecision, RetrySafetyInput } from './types.js'

/**
 * Phase 16 §23 — RETRY SAFETY. A timeout/network error never
 * automatically retries: the external system may have accepted the
 * submission despite the local failure to observe a response. Retry
 * is SAFE only when the adapter has deterministic evidence the
 * provider never received the previous attempt, or a human has
 * explicitly confirmed it's safe to proceed anyway.
 */
export function classifyRetrySafety(input: RetrySafetyInput): RetryDecision {
  if (input.lastAttemptStatus === 'SUCCEEDED') return 'NOT_RETRYABLE'
  if (input.lastAttemptStatus === 'CANCELLED') return 'NOT_RETRYABLE'

  // Errors that are inherently not retryable regardless of receipt evidence.
  const neverRetryable = new Set(['DEADLINE_PASSED', 'PACK_CHANGED', 'READINESS_INVALID', 'DUPLICATE_RISK', 'UNSUPPORTED_METHOD'])
  if (input.lastAttemptErrorCode && neverRetryable.has(input.lastAttemptErrorCode)) return 'NOT_RETRYABLE'

  // Human action required (CAPTCHA/MFA/manual) is not a "retry" case at all — it needs the human step, not another automated attempt.
  const manualOnly = new Set(['CAPTCHA_REQUIRED', 'MFA_REQUIRED', 'AUTHENTICATION_REQUIRED', 'MANUAL_ACTION_REQUIRED'])
  if (input.lastAttemptErrorCode && manualOnly.has(input.lastAttemptErrorCode)) return 'NOT_RETRYABLE'

  if (input.adapterConfirmedNotReceived) return 'SAFE_TO_RETRY'
  if (input.explicitHumanConfirmation) return 'SAFE_TO_RETRY'

  // TIMEOUT / NETWORK_ERROR / UNKNOWN_PROVIDER_RESULT / PORTAL_UNAVAILABLE
  // without deterministic non-receipt evidence: outcome unknown, never
  // auto-retried (§23 binding constraint).
  return 'UNSAFE_REQUIRES_VERIFICATION'
}
