import { describe, expect, it } from 'vitest'
import { classifyRetrySafety } from '../retry.js'

describe('classifyRetrySafety (Phase 16 §23)', () => {
  it('a timeout with no deterministic non-receipt evidence is UNSAFE, never auto-retried', () => {
    expect(classifyRetrySafety({ lastAttemptStatus: 'UNKNOWN_OUTCOME', lastAttemptErrorCode: 'TIMEOUT', adapterConfirmedNotReceived: false, explicitHumanConfirmation: false })).toBe('UNSAFE_REQUIRES_VERIFICATION')
  })

  it('a timeout the adapter deterministically proved never reached the provider is SAFE', () => {
    expect(classifyRetrySafety({ lastAttemptStatus: 'UNKNOWN_OUTCOME', lastAttemptErrorCode: 'TIMEOUT', adapterConfirmedNotReceived: true, explicitHumanConfirmation: false })).toBe('SAFE_TO_RETRY')
  })

  it('explicit human confirmation makes an otherwise-unsafe retry SAFE', () => {
    expect(classifyRetrySafety({ lastAttemptStatus: 'UNKNOWN_OUTCOME', lastAttemptErrorCode: 'TIMEOUT', adapterConfirmedNotReceived: false, explicitHumanConfirmation: true })).toBe('SAFE_TO_RETRY')
  })

  it('a succeeded attempt is never retryable', () => {
    expect(classifyRetrySafety({ lastAttemptStatus: 'SUCCEEDED', lastAttemptErrorCode: null, adapterConfirmedNotReceived: true, explicitHumanConfirmation: true })).toBe('NOT_RETRYABLE')
  })

  it('a deadline-passed failure is never retryable regardless of any confirmation', () => {
    expect(classifyRetrySafety({ lastAttemptStatus: 'FAILED', lastAttemptErrorCode: 'DEADLINE_PASSED', adapterConfirmedNotReceived: true, explicitHumanConfirmation: true })).toBe('NOT_RETRYABLE')
  })

  it('a pack-changed failure is never retryable — a new confirmation/attempt is required instead', () => {
    expect(classifyRetrySafety({ lastAttemptStatus: 'FAILED', lastAttemptErrorCode: 'PACK_CHANGED', adapterConfirmedNotReceived: false, explicitHumanConfirmation: false })).toBe('NOT_RETRYABLE')
  })

  it('CAPTCHA/MFA are manual-only, not an automated retry case', () => {
    expect(classifyRetrySafety({ lastAttemptStatus: 'REQUIRES_MANUAL_ACTION', lastAttemptErrorCode: 'CAPTCHA_REQUIRED', adapterConfirmedNotReceived: false, explicitHumanConfirmation: false })).toBe('NOT_RETRYABLE')
    expect(classifyRetrySafety({ lastAttemptStatus: 'REQUIRES_MANUAL_ACTION', lastAttemptErrorCode: 'MFA_REQUIRED', adapterConfirmedNotReceived: false, explicitHumanConfirmation: false })).toBe('NOT_RETRYABLE')
  })

  it('network error without proof is unsafe', () => {
    expect(classifyRetrySafety({ lastAttemptStatus: 'FAILED', lastAttemptErrorCode: 'NETWORK_ERROR', adapterConfirmedNotReceived: false, explicitHumanConfirmation: false })).toBe('UNSAFE_REQUIRES_VERIFICATION')
  })
})
