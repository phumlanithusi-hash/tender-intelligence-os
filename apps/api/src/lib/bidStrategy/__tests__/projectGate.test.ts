import { describe, expect, it } from 'vitest'
import { canCreateBidProject } from '../projectGate.js'

describe('canCreateBidProject (Phase 12 §5/§40) — the NO_BID→409 gate', () => {
  it('BID → allowed', () => {
    expect(canCreateBidProject({ finalDecision: 'BID', authorizedFromReview: false })).toEqual({ allowed: true })
  })

  it('REVIEW without authorization → rejected 409', () => {
    const result = canCreateBidProject({ finalDecision: 'REVIEW', authorizedFromReview: false })
    expect(result.allowed).toBe(false)
    if (!result.allowed) expect(result.httpStatus).toBe(409)
  })

  it('REVIEW with explicit authorization → allowed', () => {
    expect(canCreateBidProject({ finalDecision: 'REVIEW', authorizedFromReview: true })).toEqual({ allowed: true })
  })

  it('NO_BID → always rejected 409, never silently created', () => {
    const result = canCreateBidProject({ finalDecision: 'NO_BID', authorizedFromReview: true })
    expect(result.allowed).toBe(false)
    if (!result.allowed) expect(result.httpStatus).toBe(409)
  })

  it('NO_BID even with authorizedFromReview=true is still rejected (authorization only applies to REVIEW)', () => {
    const result = canCreateBidProject({ finalDecision: 'NO_BID', authorizedFromReview: true })
    expect(result.allowed).toBe(false)
  })

  it('no decision at all → rejected 409', () => {
    const result = canCreateBidProject({ finalDecision: null, authorizedFromReview: false })
    expect(result.allowed).toBe(false)
    if (!result.allowed) expect(result.httpStatus).toBe(409)
  })

  it('a human override that changes the final decision to BID is allowed (final decision is what the gate reads)', () => {
    // Once a human override happens, bid_decision_runs.final_decision becomes
    // 'BID' (Phase 11 semantics) — the gate never needs to know it was
    // originally NO_BID, it only ever reads the current final decision.
    expect(canCreateBidProject({ finalDecision: 'BID', authorizedFromReview: false })).toEqual({ allowed: true })
  })
})
