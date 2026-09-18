import { describe, expect, it } from 'vitest'
import { toDocumentReferences } from '../documents.js'
import { resolveAndAllowlist } from '../transport/playwrightTransport.js'

describe('toDocumentReferences (Phase 5 §17/§31)', () => {
  it('resolves a relative document URL against the base and keeps it', () => {
    const refs = toDocumentReferences([{ url: '/Home/documents/download?id=1', label: 'Bid Document.pdf' }])
    expect(refs).toEqual([
      {
        url: 'https://www.etenders.gov.za/Home/documents/download?id=1',
        filename: 'Bid Document.pdf',
        mimeType: 'application/pdf',
      },
    ])
  })

  it('drops a link whose resolved host is outside the eTenders domain, never surfacing it', () => {
    const refs = toDocumentReferences([{ url: 'https://attacker.example/malware.exe', label: 'Legit.pdf' }])
    expect(refs).toEqual([])
  })

  it('drops a link with no URL at all', () => {
    expect(toDocumentReferences([{ url: null, label: 'Something' }])).toEqual([])
  })

  it('derives a filename from the URL when no label is present', () => {
    const refs = toDocumentReferences([{ url: '/Home/documents/download/spec.docx', label: null }])
    expect(refs[0]!.filename).toBe('spec.docx')
    expect(refs[0]!.mimeType).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  })

  it('leaves mimeType undefined for an unrecognised extension rather than guessing', () => {
    const refs = toDocumentReferences([{ url: '/Home/documents/download/file', label: 'file' }])
    expect(refs[0]!.mimeType).toBeUndefined()
  })
})

describe('resolveAndAllowlist (Phase 5 §31 — enforced before any navigation)', () => {
  it('resolves a relative path against the base URL when the result is allow-listed', () => {
    expect(resolveAndAllowlist('/Home/opportunities', 'https://www.etenders.gov.za')).toBe(
      'https://www.etenders.gov.za/Home/opportunities',
    )
  })

  it('throws rather than returning a URL outside the allow-list', () => {
    expect(() => resolveAndAllowlist('https://attacker.example/x', 'https://www.etenders.gov.za')).toThrow(
      /allow-list/,
    )
  })
})
