import { describe, expect, it } from 'vitest'
import { buildStoragePath, sanitiseFilename } from '../filename.js'

describe('sanitiseFilename (Phase 6 §3)', () => {
  it('keeps an already-safe filename', () => {
    expect(sanitiseFilename('tender-document.pdf')).toBe('tender-document.pdf')
  })

  it('strips a path traversal attempt down to its basename', () => {
    expect(sanitiseFilename('../../etc/passwd')).toBe('passwd')
    expect(sanitiseFilename('..\\..\\windows\\system32\\config')).toBe('config')
  })

  it('strips an absolute path down to its basename', () => {
    expect(sanitiseFilename('/etc/passwd')).toBe('passwd')
    expect(sanitiseFilename('C:\\Windows\\evil.exe')).toBe('evil.exe')
  })

  it('replaces unsafe characters', () => {
    expect(sanitiseFilename('my file (final)!.pdf')).toBe('my_file__final__.pdf')
  })

  it('strips control and null characters', () => {
    expect(sanitiseFilename('bad\x00name\x01.pdf')).toBe('badname.pdf')
  })

  it('never returns empty, ".", or ".."', () => {
    expect(sanitiseFilename('')).toBe('document')
    expect(sanitiseFilename('.')).toBe('document')
    expect(sanitiseFilename('..')).toBe('document')
    expect(sanitiseFilename('////')).toBe('document')
  })

  it('truncates an excessively long filename while preserving the extension', () => {
    const long = 'a'.repeat(300) + '.pdf'
    const result = sanitiseFilename(long)
    expect(result.length).toBeLessThanOrEqual(180)
    expect(result.endsWith('.pdf')).toBe(true)
  })
})

describe('buildStoragePath (Phase 6 §3)', () => {
  const tenderId = '11111111-1111-1111-1111-111111111111'
  const documentId = '22222222-2222-2222-2222-222222222222'

  it('builds the documented deterministic shape', () => {
    expect(buildStoragePath(tenderId, documentId, 2, 'rfp.pdf')).toBe(
      `tenders/${tenderId}/documents/${documentId}/v2/rfp.pdf`,
    )
  })

  it('refuses a non-UUID tenderId/documentId (never accepts an externally-supplied path segment)', () => {
    expect(() => buildStoragePath('../../etc', documentId, 1, 'a.pdf')).toThrow()
    expect(() => buildStoragePath(tenderId, 'not-a-uuid', 1, 'a.pdf')).toThrow()
  })
})
