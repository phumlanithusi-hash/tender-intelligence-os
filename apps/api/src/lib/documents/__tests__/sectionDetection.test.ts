import { describe, expect, it } from 'vitest'
import { detectSections } from '../sectionDetection.js'
import type { ExtractedPage } from '../extractors/types.js'

function page(pageNumber: number, text: string): ExtractedPage {
  return { pageNumber, text, extractionMethod: 'NATIVE_TEXT', confidence: null }
}

describe('detectSections (Phase 6 §13 — deterministic only)', () => {
  it('detects numbered headings and their page ranges', () => {
    const pages = [
      page(1, '1. Introduction\n\nSome text.'),
      page(2, 'More text on the same section.'),
      page(3, '2. Scope of Work\n\nDetails.'),
    ]
    const sections = detectSections(pages)
    expect(sections.map((s) => s.sectionNumber)).toEqual(['1', '2'])
    expect(sections[0]!.pageStart).toBe(1)
    expect(sections[0]!.pageEnd).toBe(2)
    expect(sections[1]!.pageStart).toBe(3)
    expect(sections[1]!.pageEnd).toBe(3)
    expect(sections[0]!.confidence).toBeGreaterThan(0)
  })

  it('detects ANNEXURE headings', () => {
    const pages = [page(1, 'ANNEXURE A\n\nPricing schedule content.')]
    const sections = detectSections(pages)
    expect(sections[0]!.sectionNumber).toBe('Annexure A')
  })

  it('detects a plain uppercase heading line', () => {
    const pages = [page(1, 'REQUEST FOR PROPOSAL\n\nBody text here.')]
    const sections = detectSections(pages)
    expect(sections[0]!.title).toBe('REQUEST FOR PROPOSAL')
  })

  it('returns a single UNKNOWN section (confidence 0) when no headings are detected', () => {
    const pages = [page(1, 'just some lowercase running prose with no structure at all')]
    const sections = detectSections(pages)
    expect(sections).toHaveLength(1)
    expect(sections[0]!.sectionNumber).toBeNull()
    expect(sections[0]!.confidence).toBe(0)
  })

  it('puts text before the first heading into an UNKNOWN leading section', () => {
    const pages = [page(1, 'Cover page text.'), page(2, '1. Introduction\n\nBody.')]
    const sections = detectSections(pages)
    expect(sections[0]!.sectionNumber).toBeNull()
    expect(sections[0]!.pageStart).toBe(1)
    expect(sections[0]!.pageEnd).toBe(1)
    expect(sections[1]!.sectionNumber).toBe('1')
  })

  it('returns an empty array for no pages', () => {
    expect(detectSections([])).toEqual([])
  })
})
