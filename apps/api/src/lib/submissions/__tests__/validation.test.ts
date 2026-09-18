import { describe, expect, it } from 'vitest'
import { runPreflightValidation } from '../validation.js'
import type { PreflightInput } from '../types.js'

const base: PreflightInput = {
  bidExists: true,
  bidBelongsToAgency: true,
  finalBidDecision: 'BID',
  humanOverrideToBid: false,
  readinessStatus: 'READY_TO_SUBMIT',
  approvalStatus: 'APPROVED',
  approvalReferencesCurrentPack: true,
  approvalReferencesCurrentReadiness: true,
  packExists: true,
  packSuperseded: false,
  packHashMatches: true,
  manifestHashMatches: true,
  requiredFilesPresent: true,
  hasMandatoryComplianceBlocker: false,
  nowIso: '2026-09-12T00:00:00Z',
  tenderClosingDate: '2026-09-20',
  tenderClosingTime: '17:00:00',
  hasExistingConfirmedSubmission: false,
  explicitDuplicateOverride: false,
}

describe('runPreflightValidation (Phase 16 §10)', () => {
  it('allows a fully clean bid', () => {
    expect(runPreflightValidation(base).allowed).toBe(true)
  })

  it('blocks a NO_BID decision without human override', () => {
    const result = runPreflightValidation({ ...base, finalBidDecision: 'NO_BID' })
    expect(result.allowed).toBe(false)
    expect(result.blockers).toContain('NO_BID_DECISION')
  })

  it('a human override to BID lifts the NO_BID block', () => {
    const result = runPreflightValidation({ ...base, finalBidDecision: 'NO_BID', humanOverrideToBid: true })
    expect(result.blockers).not.toContain('NO_BID_DECISION')
  })

  it('blocks when readiness is not READY_TO_SUBMIT/APPROVED_FOR_SUBMISSION', () => {
    expect(runPreflightValidation({ ...base, readinessStatus: 'BLOCKED' }).blockers).toContain('READINESS_NOT_READY')
  })

  it('blocks a stale approval referencing an old pack', () => {
    expect(runPreflightValidation({ ...base, approvalReferencesCurrentPack: false }).blockers).toContain('APPROVAL_STALE')
  })

  it('blocks a missing pack', () => {
    expect(runPreflightValidation({ ...base, packExists: false }).blockers).toContain('PACK_MISSING')
  })

  it('blocks a superseded pack', () => {
    expect(runPreflightValidation({ ...base, packSuperseded: true }).blockers).toContain('PACK_SUPERSEDED')
  })

  it('blocks a changed pack hash', () => {
    expect(runPreflightValidation({ ...base, packHashMatches: false }).blockers).toContain('PACK_HASH_MISMATCH')
  })

  it('blocks a changed manifest hash', () => {
    expect(runPreflightValidation({ ...base, manifestHashMatches: false }).blockers).toContain('MANIFEST_HASH_MISMATCH')
  })

  it('blocks missing required files', () => {
    expect(runPreflightValidation({ ...base, requiredFilesPresent: false }).blockers).toContain('REQUIRED_FILES_MISSING')
  })

  it('blocks a mandatory compliance blocker', () => {
    expect(runPreflightValidation({ ...base, hasMandatoryComplianceBlocker: true }).blockers).toContain('MANDATORY_COMPLIANCE_BLOCKER')
  })

  it('blocks a passed deadline using server time, never trusting a browser clock', () => {
    expect(runPreflightValidation({ ...base, nowIso: '2026-09-21T00:00:00Z' }).blockers).toContain('DEADLINE_PASSED')
  })

  it('blocks a duplicate submission risk unless explicitly overridden', () => {
    const blocked = runPreflightValidation({ ...base, hasExistingConfirmedSubmission: true })
    expect(blocked.blockers).toContain('DUPLICATE_SUBMISSION_RISK')
    const overridden = runPreflightValidation({ ...base, hasExistingConfirmedSubmission: true, explicitDuplicateOverride: true })
    expect(overridden.blockers).not.toContain('DUPLICATE_SUBMISSION_RISK')
  })

  it('reports every blocker at once, never short-circuiting on the first', () => {
    const result = runPreflightValidation({ ...base, packExists: false, hasMandatoryComplianceBlocker: true, nowIso: '2026-09-21T00:00:00Z' })
    expect(result.blockers).toEqual(expect.arrayContaining(['PACK_MISSING', 'MANDATORY_COMPLIANCE_BLOCKER', 'DEADLINE_PASSED']))
  })

  it('rejects a cross-agency bid', () => {
    expect(runPreflightValidation({ ...base, bidBelongsToAgency: false }).blockers).toContain('CROSS_AGENCY')
  })

  it('rejects a nonexistent bid', () => {
    expect(runPreflightValidation({ ...base, bidExists: false }).blockers).toContain('BID_NOT_FOUND')
  })
})
