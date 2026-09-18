import { describe, expect, it } from 'vitest'
import { evaluateClaimSupport, renderUnsupportedClaimPlaceholder } from '../unsupportedClaims.js'

describe('evaluateClaimSupport (Phase 14 §11/§23)', () => {
  it('APPROVED_CURRENT evidence yields SUPPORTED', () => {
    expect(evaluateClaimSupport({ claimText: 'x', evidenceStatus: 'APPROVED_CURRENT' }).supportStatus).toBe('SUPPORTED')
  })

  it('APPROVED_STALE evidence yields REQUIRES_REVIEW, never silently SUPPORTED', () => {
    expect(evaluateClaimSupport({ claimText: 'x', evidenceStatus: 'APPROVED_STALE' }).supportStatus).toBe('REQUIRES_REVIEW')
  })

  it('NOT_APPROVED evidence (candidate/verified/rejected/superseded) yields REQUIRES_REVIEW, never SUPPORTED', () => {
    expect(evaluateClaimSupport({ claimText: 'x', evidenceStatus: 'NOT_APPROVED' }).supportStatus).toBe('REQUIRES_REVIEW')
  })

  it('NONE evidence yields UNSUPPORTED', () => {
    expect(evaluateClaimSupport({ claimText: 'x', evidenceStatus: 'NONE' }).supportStatus).toBe('UNSUPPORTED')
  })

  it('renders the exact spec-mandated placeholder text for an unsupported claim', () => {
    expect(renderUnsupportedClaimPlaceholder()).toBe('[REQUIRES AGENCY INPUT: Provide verified evidence supporting this claim.]')
  })
})
