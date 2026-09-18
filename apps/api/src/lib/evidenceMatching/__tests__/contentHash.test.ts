import { describe, expect, it } from 'vitest'
import { computeContentHash } from '../contentHash.js'

describe('computeContentHash (Phase 13 §A/§F)', () => {
  it('is deterministic: the same parts always hash the same', () => {
    expect(computeContentHash(['a', 'b', 1])).toBe(computeContentHash(['a', 'b', 1]))
  })

  it('changes when any content part changes (this is what flags STALE)', () => {
    expect(computeContentHash(['a', 'b'])).not.toBe(computeContentHash(['a', 'c']))
  })

  it('is sensitive to part boundaries (never confuses ["ab","c"] with ["a","bc"])', () => {
    expect(computeContentHash(['ab', 'c'])).not.toBe(computeContentHash(['a', 'bc']))
  })

  it('treats null and undefined as an empty segment, never throwing', () => {
    expect(() => computeContentHash([null, undefined, 'x'])).not.toThrow()
  })

  it('produces a hex sha256 digest (64 hex characters)', () => {
    expect(computeContentHash(['x'])).toMatch(/^[0-9a-f]{64}$/)
  })
})
