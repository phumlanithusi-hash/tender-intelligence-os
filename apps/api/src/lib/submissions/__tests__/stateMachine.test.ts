import { describe, expect, it } from 'vitest'
import { resolveSubmissionExecutionStatus } from '../stateMachine.js'
import type { StatusResolutionInput } from '../types.js'

const base: StatusResolutionInput = {
  readinessBlocked: false,
  approvalMissingOrInvalid: false,
  packInvalid: false,
  method: 'PORTAL',
  automationStatus: 'MANUAL_REQUIRED',
  confirmationRequired: false,
  attemptActive: false,
  verifiedReceiptExists: false,
  humanReportedWithoutVerifiedEvidence: false,
  lastAttemptFailedRetrySafe: false,
  lastAttemptOutcomeUnknown: false,
  cancelled: false,
  superseded: false,
}

describe('resolveSubmissionExecutionStatus (Phase 16 §37)', () => {
  it('cancelled always wins', () => {
    expect(resolveSubmissionExecutionStatus({ ...base, cancelled: true, readinessBlocked: true }).status).toBe('CANCELLED')
  })

  it('superseded beats everything except cancelled', () => {
    expect(resolveSubmissionExecutionStatus({ ...base, superseded: true, verifiedReceiptExists: true }).status).toBe('SUPERSEDED')
  })

  it('readiness blocked -> NOT_READY', () => {
    expect(resolveSubmissionExecutionStatus({ ...base, readinessBlocked: true }).status).toBe('NOT_READY')
  })

  it('approval missing/invalid -> NOT_READY', () => {
    expect(resolveSubmissionExecutionStatus({ ...base, approvalMissingOrInvalid: true }).status).toBe('NOT_READY')
  })

  it('pack invalid -> NOT_READY', () => {
    expect(resolveSubmissionExecutionStatus({ ...base, packInvalid: true }).status).toBe('NOT_READY')
  })

  it('method unknown -> REQUIRES_MANUAL_ACTION', () => {
    expect(resolveSubmissionExecutionStatus({ ...base, method: 'UNKNOWN' }).status).toBe('REQUIRES_MANUAL_ACTION')
  })

  it('automation unsupported -> REQUIRES_MANUAL_ACTION', () => {
    expect(resolveSubmissionExecutionStatus({ ...base, automationStatus: 'UNSUPPORTED' }).status).toBe('REQUIRES_MANUAL_ACTION')
  })

  it('confirmation required -> AWAITING_HUMAN_CONFIRMATION', () => {
    expect(resolveSubmissionExecutionStatus({ ...base, confirmationRequired: true }).status).toBe('AWAITING_HUMAN_CONFIRMATION')
  })

  it('attempt active -> SUBMITTING (beats verified receipt per exact spec order)', () => {
    expect(resolveSubmissionExecutionStatus({ ...base, attemptActive: true, verifiedReceiptExists: true }).status).toBe('SUBMITTING')
  })

  it('verified receipt exists -> SUBMITTED', () => {
    expect(resolveSubmissionExecutionStatus({ ...base, verifiedReceiptExists: true }).status).toBe('SUBMITTED')
  })

  it('human reported without verified evidence -> SUBMISSION_REPORTED, never SUBMITTED', () => {
    const result = resolveSubmissionExecutionStatus({ ...base, humanReportedWithoutVerifiedEvidence: true })
    expect(result.status).toBe('SUBMISSION_REPORTED')
    expect(result.status).not.toBe('SUBMITTED')
  })

  it('attempt failed, retry safe -> FAILED', () => {
    expect(resolveSubmissionExecutionStatus({ ...base, lastAttemptFailedRetrySafe: true }).status).toBe('FAILED')
  })

  it('attempt outcome unknown -> REQUIRES_MANUAL_ACTION, never FAILED and never SUBMITTED', () => {
    const result = resolveSubmissionExecutionStatus({ ...base, lastAttemptOutcomeUnknown: true })
    expect(result.status).toBe('REQUIRES_MANUAL_ACTION')
  })

  it('nothing outstanding -> READY_FOR_SUBMISSION', () => {
    expect(resolveSubmissionExecutionStatus(base).status).toBe('READY_FOR_SUBMISSION')
  })

  it('never produces a contradictory status for a fully-clean input plus a terminal flag', () => {
    const result = resolveSubmissionExecutionStatus({ ...base, cancelled: true })
    expect(['CANCELLED']).toContain(result.status)
  })
})
