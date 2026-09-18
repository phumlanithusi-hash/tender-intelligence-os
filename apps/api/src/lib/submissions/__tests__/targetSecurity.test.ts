import { describe, expect, it } from 'vitest'
import { assertSubmissionTargetSafe } from '../targetSecurity.js'

describe('assertSubmissionTargetSafe (Phase 16 §53)', () => {
  it('accepts an HTTPS portal URL on the allow-list', () => {
    const result = assertSubmissionTargetSafe({ method: 'PORTAL', target: 'https://etenders.gov.za/x', verifiedTenderTarget: 'https://etenders.gov.za/x', allowedHosts: ['etenders.gov.za'], humanConfirmedDeviation: false })
    expect(result.valid).toBe(true)
  })

  it('rejects a non-HTTPS portal URL', () => {
    const result = assertSubmissionTargetSafe({ method: 'PORTAL', target: 'http://etenders.gov.za/x', verifiedTenderTarget: null, allowedHosts: ['etenders.gov.za'], humanConfirmedDeviation: false })
    expect(result.valid).toBe(false)
  })

  it('rejects a URL host not on the allow-list', () => {
    const result = assertSubmissionTargetSafe({ method: 'PORTAL', target: 'https://evil.example.com/x', verifiedTenderTarget: null, allowedHosts: ['etenders.gov.za'], humanConfirmedDeviation: false })
    expect(result.valid).toBe(false)
  })

  it('flags a deviation from the verified tender recipient and requires confirmation', () => {
    const result = assertSubmissionTargetSafe({ method: 'EMAIL', target: 'someoneelse@example.com', verifiedTenderTarget: 'tenders@agency.gov.za', allowedHosts: [], humanConfirmedDeviation: false })
    expect(result.valid).toBe(false)
    expect(result.deviatesFromVerifiedTarget).toBe(true)
    expect(result.requiresConfirmation).toBe(true)
  })

  it('allows a deviation once explicitly confirmed by a human', () => {
    const result = assertSubmissionTargetSafe({ method: 'EMAIL', target: 'someoneelse@example.com', verifiedTenderTarget: 'tenders@agency.gov.za', allowedHosts: [], humanConfirmedDeviation: true })
    expect(result.valid).toBe(true)
  })

  it('rejects a structurally invalid email address', () => {
    expect(assertSubmissionTargetSafe({ method: 'EMAIL', target: 'not-an-email', verifiedTenderTarget: null, allowedHosts: [], humanConfirmedDeviation: false }).valid).toBe(false)
  })
})
