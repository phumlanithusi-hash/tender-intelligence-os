import { describe, expect, it } from 'vitest'
import { computeEvidenceGap, computeEvidenceGaps } from '../gaps.js'
import type { EvidenceGapComputationInput } from '../types.js'

function input(overrides: Partial<EvidenceGapComputationInput> = {}): EvidenceGapComputationInput {
  return {
    need: { id: 'need-1', minimumCount: 1, severity: 'HIGH', currentStatus: 'OPEN' },
    approvedClaimCount: 0,
    hasOnlyRejectedOrNoCandidates: false,
    ...overrides,
  }
}

describe('computeEvidenceGap (Phase 13 §E — evidence gap feedback loop, pure)', () => {
  it('recommends SATISFIED once approved claims meet the minimum count', () => {
    const result = computeEvidenceGap(input({ approvedClaimCount: 1, need: { id: 'n', minimumCount: 1, severity: 'HIGH', currentStatus: 'OPEN' } }))
    expect(result.recommendedStatus).toBe('SATISFIED')
    expect(result.isGap).toBe(false)
  })

  it('recommends SATISFIED when approved claims exceed the minimum count', () => {
    const result = computeEvidenceGap(input({ approvedClaimCount: 3, need: { id: 'n', minimumCount: 2, severity: 'HIGH', currentStatus: 'OPEN' } }))
    expect(result.recommendedStatus).toBe('SATISFIED')
  })

  it('recommends PARTIALLY_SATISFIED when some but not enough claims are approved', () => {
    const result = computeEvidenceGap(input({ approvedClaimCount: 1, need: { id: 'n', minimumCount: 3, severity: 'CRITICAL', currentStatus: 'OPEN' } }))
    expect(result.recommendedStatus).toBe('PARTIALLY_SATISFIED')
    expect(result.isGap).toBe(true)
  })

  it('recommends OPEN (and flags a gap) when no claim has ever been approved', () => {
    const result = computeEvidenceGap(input({ approvedClaimCount: 0 }))
    expect(result.recommendedStatus).toBe('OPEN')
    expect(result.isGap).toBe(true)
  })

  it('a candidate generation run that produced only rejections still surfaces as a gap, never silently swept away', () => {
    const result = computeEvidenceGap(input({ approvedClaimCount: 0, hasOnlyRejectedOrNoCandidates: true }))
    expect(result.isGap).toBe(true)
    expect(result.reason).toMatch(/rejected/i)
  })

  it('never overrides a human/rule-set WAIVED status', () => {
    const result = computeEvidenceGap(input({ need: { id: 'n', minimumCount: 1, severity: 'LOW', currentStatus: 'WAIVED' }, approvedClaimCount: 0 }))
    expect(result.recommendedStatus).toBe('WAIVED')
    expect(result.isGap).toBe(false)
  })

  it('never overrides a BLOCKED status, and still reports it as an active gap', () => {
    const result = computeEvidenceGap(input({ need: { id: 'n', minimumCount: 1, severity: 'CRITICAL', currentStatus: 'BLOCKED' }, approvedClaimCount: 0 }))
    expect(result.recommendedStatus).toBe('BLOCKED')
    expect(result.isGap).toBe(true)
  })

  it('never marks SATISFIED from candidate/semantic activity alone — only a real approved-claim count moves it', () => {
    const result = computeEvidenceGap(input({ approvedClaimCount: 0, hasOnlyRejectedOrNoCandidates: false }))
    expect(result.recommendedStatus).not.toBe('SATISFIED')
  })

  it('computeEvidenceGaps maps over a batch of needs, preserving each evidenceNeedId', () => {
    const results = computeEvidenceGaps([input({ need: { id: 'a', minimumCount: 1, severity: 'LOW', currentStatus: 'OPEN' } }), input({ need: { id: 'b', minimumCount: 1, severity: 'LOW', currentStatus: 'OPEN' }, approvedClaimCount: 1 })])
    expect(results.map((r) => r.evidenceNeedId)).toEqual(['a', 'b'])
    expect(results[1]!.recommendedStatus).toBe('SATISFIED')
  })

  it('is pure: identical inputs always produce identical output', () => {
    const i = input({ approvedClaimCount: 2, need: { id: 'n', minimumCount: 3, severity: 'MEDIUM', currentStatus: 'PARTIALLY_SATISFIED' } })
    expect(computeEvidenceGap(i)).toEqual(computeEvidenceGap(i))
  })
})
