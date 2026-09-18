import { describe, expect, it } from 'vitest'
import { verifyEvidenceCandidate } from '../verifyEvidenceCandidate.js'
import type { VerificationCandidateInput, VerificationEvidenceNeedInput } from '../types.js'

const NOW = '2026-09-11T00:00:00.000Z'
const need: VerificationEvidenceNeedInput = { id: 'need-1', requiredAgencyId: 'agency-1', allowedEntityTypes: null }

function candidate(overrides: Partial<VerificationCandidateInput> = {}): VerificationCandidateInput {
  return {
    entityType: 'AGENCY_CERTIFICATE',
    entityId: 'cert-1',
    candidateAgencyId: 'agency-1',
    evidenceStatus: 'VERIFIED',
    expiryDate: null,
    sourceActive: true,
    embeddingStatus: 'READY',
    ...overrides,
  }
}

describe('verifyEvidenceCandidate (Phase 13 §C — pure deterministic verification)', () => {
  it('a fully-fit, VERIFIED-status candidate resolves to VERIFIED', () => {
    const result = verifyEvidenceCandidate(candidate(), need, { nowIso: NOW })
    expect(result.resultingStatus).toBe('VERIFIED')
    expect(result.passed).toBe(true)
  })

  it('an INFERRED-status candidate (still a known status) also resolves to VERIFIED', () => {
    const result = verifyEvidenceCandidate(candidate({ evidenceStatus: 'INFERRED' }), need, { nowIso: NOW })
    expect(result.resultingStatus).toBe('VERIFIED')
  })

  it('NEVER returns APPROVED or REJECTED — those are exclusively human-actioned', () => {
    const allStatuses: Array<VerificationCandidateInput['evidenceStatus']> = ['VERIFIED', 'INFERRED', 'UNVERIFIED', 'UNKNOWN']
    for (const evidenceStatus of allStatuses) {
      const result = verifyEvidenceCandidate(candidate({ evidenceStatus }), need, { nowIso: NOW })
      expect(result.resultingStatus).not.toBe('APPROVED')
      expect(result.resultingStatus).not.toBe('REJECTED')
    }
  })

  it('an UNKNOWN evidence status is never silently promoted to VERIFIED (caps at REQUIRES_VERIFICATION)', () => {
    const result = verifyEvidenceCandidate(candidate({ evidenceStatus: 'UNKNOWN' }), need, { nowIso: NOW })
    expect(result.resultingStatus).toBe('REQUIRES_VERIFICATION')
    expect(result.passed).toBe(true) // structurally fine, just not independently verified yet
  })

  it('an UNVERIFIED evidence status also caps at REQUIRES_VERIFICATION', () => {
    const result = verifyEvidenceCandidate(candidate({ evidenceStatus: 'UNVERIFIED' }), need, { nowIso: NOW })
    expect(result.resultingStatus).toBe('REQUIRES_VERIFICATION')
  })

  it('a candidate belonging to a different agency fails AGENCY_MATCH and never reaches VERIFIED (cross-tenant rejection)', () => {
    const result = verifyEvidenceCandidate(candidate({ candidateAgencyId: 'agency-OTHER' }), need, { nowIso: NOW })
    expect(result.passed).toBe(false)
    expect(result.resultingStatus).toBe('CANDIDATE')
    expect(result.checks.find((c) => c.code === 'AGENCY_MATCH')?.passed).toBe(false)
  })

  it('a superseded/inactive source fails SOURCE_ACTIVE regardless of semantic fit', () => {
    const result = verifyEvidenceCandidate(candidate({ sourceActive: false }), need, { nowIso: NOW })
    expect(result.passed).toBe(false)
    expect(result.resultingStatus).toBe('CANDIDATE')
  })

  it('an expired certificate fails NOT_EXPIRED', () => {
    const result = verifyEvidenceCandidate(candidate({ expiryDate: '2020-01-01' }), need, { nowIso: NOW })
    expect(result.checks.find((c) => c.code === 'NOT_EXPIRED')?.passed).toBe(false)
    expect(result.resultingStatus).toBe('CANDIDATE')
  })

  it('a future expiry date passes NOT_EXPIRED', () => {
    const result = verifyEvidenceCandidate(candidate({ expiryDate: '2030-01-01' }), need, { nowIso: NOW })
    expect(result.checks.find((c) => c.code === 'NOT_EXPIRED')?.passed).toBe(true)
  })

  it('a null expiryDate (no expiry concept for this evidence type) always passes NOT_EXPIRED', () => {
    const result = verifyEvidenceCandidate(candidate({ expiryDate: null }), need, { nowIso: NOW })
    expect(result.checks.find((c) => c.code === 'NOT_EXPIRED')?.passed).toBe(true)
  })

  it('a type restriction on the evidence need that excludes this candidate fails TYPE_ELIGIBLE', () => {
    const restricted: VerificationEvidenceNeedInput = { ...need, allowedEntityTypes: ['AGENCY_CASE_STUDY'] }
    const result = verifyEvidenceCandidate(candidate({ entityType: 'AGENCY_CERTIFICATE' }), restricted, { nowIso: NOW })
    expect(result.checks.find((c) => c.code === 'TYPE_ELIGIBLE')?.passed).toBe(false)
    expect(result.resultingStatus).toBe('CANDIDATE')
  })

  it('a non-READY/STALE embedding status fails EMBEDDING_AVAILABLE', () => {
    const result = verifyEvidenceCandidate(candidate({ embeddingStatus: 'FAILED' }), need, { nowIso: NOW })
    expect(result.checks.find((c) => c.code === 'EMBEDDING_AVAILABLE')?.passed).toBe(false)
    expect(result.resultingStatus).toBe('CANDIDATE')
  })

  it('a STALE embedding still counts as available (only FAILED/QUEUED/PROCESSING/NOT_EMBEDDED do not)', () => {
    const result = verifyEvidenceCandidate(candidate({ embeddingStatus: 'STALE' }), need, { nowIso: NOW })
    expect(result.checks.find((c) => c.code === 'EMBEDDING_AVAILABLE')?.passed).toBe(true)
  })

  it('every check is always returned, even when it passes (full transparency, not just failures)', () => {
    const result = verifyEvidenceCandidate(candidate(), need, { nowIso: NOW })
    expect(result.checks.length).toBeGreaterThanOrEqual(6)
    expect(result.checks.every((c) => typeof c.message === 'string' && c.message.length > 0)).toBe(true)
  })

  it('is pure: identical inputs always produce identical output', () => {
    const c = candidate()
    const result1 = verifyEvidenceCandidate(c, need, { nowIso: NOW })
    const result2 = verifyEvidenceCandidate(c, need, { nowIso: NOW })
    expect(result1).toEqual(result2)
  })
})
