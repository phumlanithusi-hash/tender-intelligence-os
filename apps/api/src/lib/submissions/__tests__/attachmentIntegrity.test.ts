import { describe, expect, it } from 'vitest'
import { verifyAttachmentsAgainstManifest } from '../attachmentIntegrity.js'

const approved = [{ fileName: 'proposal.pdf', sizeBytes: 1024, sha256: 'abc', mimeType: 'application/pdf' }]

describe('verifyAttachmentsAgainstManifest (Phase 16 §16)', () => {
  it('valid when the outgoing attachment matches the manifest exactly', () => {
    expect(verifyAttachmentsAgainstManifest(approved, approved).valid).toBe(true)
  })

  it('invalid when the hash differs', () => {
    const result = verifyAttachmentsAgainstManifest(approved, [{ ...approved[0]!, sha256: 'different' }])
    expect(result.valid).toBe(false)
    expect(result.mismatches[0]).toMatch(/content hash/)
  })

  it('invalid when a file is missing entirely', () => {
    const result = verifyAttachmentsAgainstManifest(approved, [])
    expect(result.valid).toBe(false)
  })

  it('invalid when the size differs', () => {
    expect(verifyAttachmentsAgainstManifest(approved, [{ ...approved[0]!, sizeBytes: 2048 }]).valid).toBe(false)
  })

  it('invalid when the MIME type differs', () => {
    expect(verifyAttachmentsAgainstManifest(approved, [{ ...approved[0]!, mimeType: 'application/msword' }]).valid).toBe(false)
  })
})
