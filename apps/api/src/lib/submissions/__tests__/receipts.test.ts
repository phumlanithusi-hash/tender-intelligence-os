import { describe, expect, it } from 'vitest'
import { classifyReceiptVerification, hasSufficientVerifiedEvidence } from '../receipts.js'

describe('classifyReceiptVerification (Phase 16 §20)', () => {
  it('a provider-issued receipt is VERIFIED', () => {
    expect(classifyReceiptVerification({ receiptType: 'PORTAL_RECEIPT', providerIssued: true, corroborated: false, conflictsWithAnotherReceipt: false })).toBe('VERIFIED')
  })

  it('a user-entered reference alone is UNVERIFIED, never VERIFIED', () => {
    expect(classifyReceiptVerification({ receiptType: 'MANUAL_ATTESTATION', providerIssued: false, corroborated: false, conflictsWithAnotherReceipt: false })).toBe('UNVERIFIED')
  })

  it('a corroborated (but not itself provider-issued) reference is VERIFIED', () => {
    expect(classifyReceiptVerification({ receiptType: 'PROCUREMENT_REFERENCE', providerIssued: false, corroborated: true, conflictsWithAnotherReceipt: false })).toBe('VERIFIED')
  })

  it('two disagreeing receipts are CONFLICTING regardless of provenance', () => {
    expect(classifyReceiptVerification({ receiptType: 'COURIER_TRACKING', providerIssued: true, corroborated: false, conflictsWithAnotherReceipt: true })).toBe('CONFLICTING')
  })
})

describe('hasSufficientVerifiedEvidence (Phase 16 §5/§62)', () => {
  it('is false with no receipts (MISSING)', () => {
    expect(hasSufficientVerifiedEvidence([])).toBe(false)
  })

  it('is false with only UNVERIFIED receipts — never enough to claim SUBMITTED', () => {
    expect(hasSufficientVerifiedEvidence(['UNVERIFIED', 'CAPTURED'])).toBe(false)
  })

  it('is true once at least one VERIFIED receipt exists', () => {
    expect(hasSufficientVerifiedEvidence(['UNVERIFIED', 'VERIFIED'])).toBe(true)
  })
})
