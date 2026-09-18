import { describe, expect, it } from 'vitest'
import { isConfirmationStillValid } from '../confirmation.js'
import type { ConfirmationValidityInput } from '../types.js'

const valid: ConfirmationValidityInput = {
  confirmationPackId: 'pack-1',
  confirmationPackVersion: 3,
  confirmationPackHash: 'hash-abc',
  confirmationManifestHash: 'manifest-abc',
  confirmationReadinessId: 'readiness-1',
  currentPackId: 'pack-1',
  currentPackVersion: 3,
  currentPackHash: 'hash-abc',
  currentManifestHash: 'manifest-abc',
  currentReadinessId: 'readiness-1',
  confirmationInvalidated: false,
}

describe('isConfirmationStillValid (Phase 16 §8/§9)', () => {
  it('valid when everything matches exactly', () => {
    expect(isConfirmationStillValid(valid)).toBe(true)
  })

  it('invalid when the pack version changed (e.g. user edited pricing -> new pack v5 under a v4 approval)', () => {
    expect(isConfirmationStillValid({ ...valid, currentPackVersion: 5, currentPackId: 'pack-2' })).toBe(false)
  })

  it('invalid when only the hash changed but the id/version look the same (defence in depth)', () => {
    expect(isConfirmationStillValid({ ...valid, currentPackHash: 'hash-changed' })).toBe(false)
  })

  it('invalid when the manifest hash changed', () => {
    expect(isConfirmationStillValid({ ...valid, currentManifestHash: 'manifest-changed' })).toBe(false)
  })

  it('invalid when the readiness snapshot changed', () => {
    expect(isConfirmationStillValid({ ...valid, currentReadinessId: 'readiness-2' })).toBe(false)
  })

  it('invalid when explicitly invalidated, even if everything else still matches', () => {
    expect(isConfirmationStillValid({ ...valid, confirmationInvalidated: true })).toBe(false)
  })

  it('invalid when there is no current pack/readiness at all', () => {
    expect(isConfirmationStillValid({ ...valid, currentPackId: null, currentReadinessId: null })).toBe(false)
  })
})
