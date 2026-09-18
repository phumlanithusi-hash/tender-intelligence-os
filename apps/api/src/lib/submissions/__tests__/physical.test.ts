import { describe, expect, it } from 'vitest'
import { canTransitionPhysicalStage } from '../physical.js'

describe('canTransitionPhysicalStage (Phase 16 §17)', () => {
  it('PREPARED -> DISPATCHED requires dispatch evidence', () => {
    expect(canTransitionPhysicalStage({ currentStage: 'PREPARED', targetStage: 'DISPATCHED', hasDispatchEvidence: false, hasDeliveryEvidence: false, hasProofOfDelivery: false, hasHumanAttestation: false }).allowed).toBe(false)
    expect(canTransitionPhysicalStage({ currentStage: 'PREPARED', targetStage: 'DISPATCHED', hasDispatchEvidence: true, hasDeliveryEvidence: false, hasProofOfDelivery: false, hasHumanAttestation: false }).allowed).toBe(true)
  })

  it('DISPATCHED never implies SUBMITTED — cannot skip straight there', () => {
    const result = canTransitionPhysicalStage({ currentStage: 'DISPATCHED', targetStage: 'SUBMITTED', hasDispatchEvidence: true, hasDeliveryEvidence: true, hasProofOfDelivery: true, hasHumanAttestation: true })
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/skipped/i)
  })

  it('cannot move backwards', () => {
    expect(canTransitionPhysicalStage({ currentStage: 'DELIVERED', targetStage: 'DISPATCHED', hasDispatchEvidence: true, hasDeliveryEvidence: true, hasProofOfDelivery: true, hasHumanAttestation: true }).allowed).toBe(false)
  })

  it('DELIVERED requires delivery evidence', () => {
    expect(canTransitionPhysicalStage({ currentStage: 'IN_TRANSIT', targetStage: 'DELIVERED', hasDispatchEvidence: true, hasDeliveryEvidence: false, hasProofOfDelivery: false, hasHumanAttestation: false }).allowed).toBe(false)
  })

  it('SUBMISSION_REPORTED requires a human attestation', () => {
    expect(canTransitionPhysicalStage({ currentStage: 'DELIVERED', targetStage: 'SUBMISSION_REPORTED', hasDispatchEvidence: true, hasDeliveryEvidence: true, hasProofOfDelivery: false, hasHumanAttestation: false }).allowed).toBe(false)
    expect(canTransitionPhysicalStage({ currentStage: 'DELIVERED', targetStage: 'SUBMISSION_REPORTED', hasDispatchEvidence: true, hasDeliveryEvidence: true, hasProofOfDelivery: false, hasHumanAttestation: true }).allowed).toBe(true)
  })

  it('SUBMITTED requires proof of delivery, not merely a human report', () => {
    const withoutProof = canTransitionPhysicalStage({ currentStage: 'SUBMISSION_REPORTED', targetStage: 'SUBMITTED', hasDispatchEvidence: true, hasDeliveryEvidence: true, hasProofOfDelivery: false, hasHumanAttestation: true })
    expect(withoutProof.allowed).toBe(false)
    const withProof = canTransitionPhysicalStage({ currentStage: 'SUBMISSION_REPORTED', targetStage: 'SUBMITTED', hasDispatchEvidence: true, hasDeliveryEvidence: true, hasProofOfDelivery: true, hasHumanAttestation: true })
    expect(withProof.allowed).toBe(true)
  })
})
