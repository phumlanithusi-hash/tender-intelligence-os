import { describe, expect, it } from 'vitest'
import { isAllowedDocumentUrl } from '../allowlist.js'

describe('isAllowedDocumentUrl (Phase 5 §31 — SSRF/domain allow-list)', () => {
  it('allows the exact configured host over https', () => {
    expect(isAllowedDocumentUrl('https://www.etenders.gov.za/Home/documents/x.pdf')).toBe(true)
  })

  it('allows a subdomain of an allowed host', () => {
    expect(isAllowedDocumentUrl('https://docs.etenders.gov.za/x.pdf', ['etenders.gov.za'])).toBe(true)
  })

  it('rejects a different domain entirely', () => {
    expect(isAllowedDocumentUrl('https://evil.example/x.pdf')).toBe(false)
  })

  it('rejects a lookalike domain that merely contains the allowed host as a substring', () => {
    expect(isAllowedDocumentUrl('https://www.etenders.gov.za.evil.example/x.pdf')).toBe(false)
  })

  it('rejects a prefix trick like "notetenders.gov.za"', () => {
    expect(isAllowedDocumentUrl('https://notetenders.gov.za/x.pdf', ['etenders.gov.za'])).toBe(false)
  })

  it('rejects non-https schemes, including javascript: and data:', () => {
    expect(isAllowedDocumentUrl('http://www.etenders.gov.za/x.pdf')).toBe(false)
    expect(isAllowedDocumentUrl('javascript:alert(1)')).toBe(false)
    expect(isAllowedDocumentUrl('data:text/plain;base64,AAAA')).toBe(false)
    expect(isAllowedDocumentUrl('file:///etc/passwd')).toBe(false)
  })

  it('rejects malformed URLs rather than throwing', () => {
    expect(isAllowedDocumentUrl('not a url')).toBe(false)
    expect(isAllowedDocumentUrl('')).toBe(false)
  })

  it('is case-insensitive on the hostname', () => {
    expect(isAllowedDocumentUrl('https://WWW.ETENDERS.GOV.ZA/x.pdf')).toBe(true)
  })
})
