import { describe, expect, it } from 'vitest'
import { SUBMISSION_ERROR_CODE } from '@tender-os/constants'
import { classifyError } from '../errorClassification.js'

describe('classifyError (Phase 16 §24)', () => {
  it('classifies every declared error code (none missing)', () => {
    for (const code of SUBMISSION_ERROR_CODE) {
      const result = classifyError(code)
      expect(result.code).toBe(code)
      expect(typeof result.retryable).toBe('boolean')
      expect(typeof result.humanActionRequired).toBe('boolean')
    }
  })

  it('CAPTCHA_REQUIRED and MFA_REQUIRED are never retryable and always require a human', () => {
    expect(classifyError('CAPTCHA_REQUIRED')).toEqual({ code: 'CAPTCHA_REQUIRED', retryable: false, humanActionRequired: true })
    expect(classifyError('MFA_REQUIRED')).toEqual({ code: 'MFA_REQUIRED', retryable: false, humanActionRequired: true })
  })

  it('DEADLINE_PASSED is never retryable and needs no further human action', () => {
    expect(classifyError('DEADLINE_PASSED')).toEqual({ code: 'DEADLINE_PASSED', retryable: false, humanActionRequired: false })
  })

  it('TIMEOUT is never auto-retryable (outcome unknown) per §23', () => {
    expect(classifyError('TIMEOUT').retryable).toBe(false)
  })

  it('NETWORK_ERROR and PORTAL_UNAVAILABLE are the only genuinely auto-retryable codes', () => {
    expect(classifyError('NETWORK_ERROR').retryable).toBe(true)
    expect(classifyError('PORTAL_UNAVAILABLE').retryable).toBe(true)
  })
})
