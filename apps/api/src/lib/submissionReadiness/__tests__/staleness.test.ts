import { describe, expect, it } from 'vitest'
import { isSnapshotStale, isApprovalStillValid } from '../staleness.js'

/** Phase 15 §57 — 8 staleness/invalidation tests. */
describe('submission readiness staleness/invalidation (Phase 15 §36/§48)', () => {
  it('a requirement change invalidates a snapshot', () => {
    expect(isSnapshotStale({ requirements: ['a'] }, { requirements: ['a', 'b'] })).toBe(true)
  })

  it('an evaluation criterion change invalidates a snapshot', () => {
    expect(isSnapshotStale({ evaluation: [{ id: 'c1', weight: 40 }] }, { evaluation: [{ id: 'c1', weight: 50 }] })).toBe(true)
  })

  it('a proposal version change invalidates a snapshot', () => {
    expect(isSnapshotStale({ proposalVersionId: 'v1' }, { proposalVersionId: 'v2' })).toBe(true)
  })

  it('a pricing change invalidates a snapshot', () => {
    expect(isSnapshotStale({ pricingId: 'p1', total: 1000 }, { pricingId: 'p1', total: 1500 })).toBe(true)
  })

  it('a certificate expiry invalidates a snapshot', () => {
    expect(isSnapshotStale({ certificates: [{ id: 'c1', status: 'VALID' }] }, { certificates: [{ id: 'c1', status: 'EXPIRED' }] })).toBe(true)
  })

  it('evidence becoming stale invalidates a snapshot', () => {
    expect(isSnapshotStale({ evidence: [{ id: 'e1', lifecycle: 'APPROVED_CURRENT' }] }, { evidence: [{ id: 'e1', lifecycle: 'APPROVED_STALE' }] })).toBe(true)
  })

  it('a submission instruction change invalidates a snapshot', () => {
    expect(isSnapshotStale({ submissionMethod: 'PORTAL' }, { submissionMethod: 'EMAIL' })).toBe(true)
  })

  it('a deadline change invalidates a snapshot, and an approval drifting from the current pack/readiness is no longer valid', () => {
    expect(isSnapshotStale({ closingDate: '2026-10-01' }, { closingDate: '2026-10-15' })).toBe(true)
    expect(isApprovalStillValid({ approvalPackId: 'pack-1', currentPackId: 'pack-2', approvalReadinessId: 'r-1', currentReadinessId: 'r-1' })).toBe(false)
    expect(isApprovalStillValid({ approvalPackId: 'pack-1', currentPackId: 'pack-1', approvalReadinessId: 'r-1', currentReadinessId: 'r-1' })).toBe(true)
  })
})
