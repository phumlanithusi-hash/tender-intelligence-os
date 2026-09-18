import { describe, expect, it } from 'vitest'
import { sha256Hex } from '../hashing.js'

describe('sha256Hex (Phase 6 §5/§6)', () => {
  it('is deterministic for identical bytes', () => {
    const a = sha256Hex(Buffer.from('hello world'))
    const b = sha256Hex(Buffer.from('hello world'))
    expect(a).toBe(b)
    expect(a).toHaveLength(64)
  })

  it('differs for different bytes', () => {
    const a = sha256Hex(Buffer.from('hello world'))
    const b = sha256Hex(Buffer.from('hello world!'))
    expect(a).not.toBe(b)
  })

  it('matches a known SHA-256 test vector', () => {
    expect(sha256Hex(Buffer.from(''))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })
})
