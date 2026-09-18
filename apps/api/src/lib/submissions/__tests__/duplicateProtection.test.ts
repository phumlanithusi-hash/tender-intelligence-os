import { describe, expect, it } from 'vitest'
import { checkDuplicateSubmission } from '../duplicateProtection.js'

describe('checkDuplicateSubmission (Phase 16 §22)', () => {
  it('proceeds when no prior confirmed submission exists', () => {
    expect(checkDuplicateSubmission({ existingConfirmedSubmissionExists: false, samePackVersion: false, sameTarget: false, sameMethod: false, explicitOverride: false })).toBe('PROCEED')
  })

  it('blocks a second attempt on the same pack/target/method without an explicit override', () => {
    expect(checkDuplicateSubmission({ existingConfirmedSubmissionExists: true, samePackVersion: true, sameTarget: true, sameMethod: true, explicitOverride: false })).toBe('ALREADY_RECORDED_BLOCKED')
  })

  it('a changed pack still requires an explicit override, never an automatic retry', () => {
    expect(checkDuplicateSubmission({ existingConfirmedSubmissionExists: true, samePackVersion: false, sameTarget: true, sameMethod: true, explicitOverride: false })).toBe('ALREADY_RECORDED_BLOCKED')
  })

  it('an explicit human override allows proceeding, distinctly labelled', () => {
    expect(checkDuplicateSubmission({ existingConfirmedSubmissionExists: true, samePackVersion: true, sameTarget: true, sameMethod: true, explicitOverride: true })).toBe('ALREADY_RECORDED_OVERRIDDEN')
  })
})
