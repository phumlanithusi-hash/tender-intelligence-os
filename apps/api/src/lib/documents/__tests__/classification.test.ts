import { describe, expect, it } from 'vitest'
import { classifyDocument } from '../classification.js'
import type { ExtractedPage } from '../extractors/types.js'

function page(text: string): ExtractedPage {
  return { pageNumber: 1, text, extractionMethod: 'NATIVE_TEXT', confidence: null }
}

describe('classifyDocument (Phase 6 §23 — deterministic only)', () => {
  it('classifies by filename when unambiguous', () => {
    expect(classifyDocument('Addendum-1.pdf', []).classification).toBe('ADDENDUM')
    expect(classifyDocument('SBD4-declaration.pdf', []).classification).toBe('SBD_FORM')
    expect(classifyDocument('Pricing-Schedule.xlsx', []).classification).toBe('PRICING_SCHEDULE')
  })

  it('falls back to early page text when the filename is uninformative', () => {
    const result = classifyDocument('document.pdf', [page('REQUEST FOR PROPOSAL for cleaning services')])
    expect(result.classification).toBe('RFP')
    expect(result.confidence).toBeGreaterThan(0)
  })

  it('returns UNKNOWN with zero confidence when nothing matches, never guessing', () => {
    const result = classifyDocument('file123.pdf', [page('Some entirely generic content with no procurement keywords.')])
    expect(result.classification).toBe('UNKNOWN')
    expect(result.confidence).toBe(0)
  })

  it('prefers filename match over page text when both exist', () => {
    const result = classifyDocument('annexure-a.pdf', [page('REQUEST FOR PROPOSAL text that would otherwise match RFP')])
    expect(result.classification).toBe('ANNEXURE')
  })
})
