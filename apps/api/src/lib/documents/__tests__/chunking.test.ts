import { describe, expect, it } from 'vitest'
import { chunkDocument } from '../chunking.js'
import type { ExtractedPage } from '../extractors/types.js'
import type { DetectedSection } from '../sectionDetection.js'

function page(pageNumber: number, text: string): ExtractedPage {
  return { pageNumber, text, extractionMethod: 'NATIVE_TEXT', confidence: null }
}

describe('chunkDocument (Phase 6 §14 — deterministic chunking)', () => {
  it('produces one chunk per short section, carrying page range and section index', () => {
    const pages = [page(1, 'Paragraph one.\n\nParagraph two.'), page(2, 'Paragraph three.')]
    const sections: DetectedSection[] = [
      { sectionIndex: 0, sectionNumber: '1', title: 'Intro', pageStart: 1, pageEnd: 2, confidence: 0.8 },
    ]
    const chunks = chunkDocument(pages, sections)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]!.chunkIndex).toBe(0)
    expect(chunks[0]!.sectionIndex).toBe(0)
    expect(chunks[0]!.pageStart).toBe(1)
    expect(chunks[0]!.pageEnd).toBe(2)
    expect(chunks[0]!.text).toContain('Paragraph one.')
    expect(chunks[0]!.text).toContain('Paragraph three.')
  })

  it('splits a section into multiple chunks once the target size is exceeded, at paragraph boundaries', () => {
    const bigParagraph = (n: number) => `Paragraph number ${n}. `.repeat(80) // ~1900 chars per paragraph
    const pages = [page(1, [bigParagraph(1), bigParagraph(2), bigParagraph(3)].join('\n\n'))]
    const sections: DetectedSection[] = [{ sectionIndex: 0, sectionNumber: null, title: null, pageStart: 1, pageEnd: 1, confidence: 0 }]
    const chunks = chunkDocument(pages, sections)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.charCount).toBeLessThanOrEqual(3000)
      expect(chunk.tokenEstimate).toBeGreaterThan(0)
    }
    // Chunk boundaries fall between paragraphs, never mid-sentence.
    expect(chunks[0]!.text.trim().endsWith('.')).toBe(true)
  })

  it('hard-splits a single paragraph that alone exceeds the max chunk size', () => {
    const hugeParagraph = 'x'.repeat(7000)
    const pages = [page(1, hugeParagraph)]
    const sections: DetectedSection[] = [{ sectionIndex: 0, sectionNumber: null, title: null, pageStart: 1, pageEnd: 1, confidence: 0 }]
    const chunks = chunkDocument(pages, sections)
    expect(chunks.length).toBe(3)
    for (const chunk of chunks) expect(chunk.charCount).toBeLessThanOrEqual(3000)
  })

  it('is deterministic — identical input produces identical output', () => {
    const pages = [page(1, 'Alpha.\n\nBeta.\n\nGamma.')]
    const sections: DetectedSection[] = [{ sectionIndex: 0, sectionNumber: null, title: null, pageStart: 1, pageEnd: 1, confidence: 0 }]
    const a = chunkDocument(pages, sections)
    const b = chunkDocument(pages, sections)
    expect(a).toEqual(b)
  })

  it('never lets a chunk span two different sections', () => {
    const pages = [page(1, 'Section one text.'), page(2, 'Section two text.')]
    const sections: DetectedSection[] = [
      { sectionIndex: 0, sectionNumber: '1', title: 'One', pageStart: 1, pageEnd: 1, confidence: 0.8 },
      { sectionIndex: 1, sectionNumber: '2', title: 'Two', pageStart: 2, pageEnd: 2, confidence: 0.8 },
    ]
    const chunks = chunkDocument(pages, sections)
    expect(chunks).toHaveLength(2)
    expect(chunks[0]!.sectionIndex).toBe(0)
    expect(chunks[1]!.sectionIndex).toBe(1)
  })
})
