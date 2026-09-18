import type { ExtractedPage } from './extractors/types.js'

export interface DetectedSection {
  sectionIndex: number
  sectionNumber: string | null
  title: string | null
  pageStart: number
  pageEnd: number
  confidence: number
}

interface HeadingCandidate {
  pageNumber: number
  lineIndex: number
  sectionNumber: string | null
  title: string | null
  confidence: number
}

// Numbered heading: "1. Introduction", "3.2 Technical Requirements", "Section 4:  Pricing".
const NUMBERED_HEADING = /^(?:section\s+)?(\d+(?:\.\d+)*)[.):\s-]+\s*(.{2,120})$/i
// Annexure / Appendix style headings, common in SA tender documents.
const ANNEXURE_HEADING = /^(annexure|appendix|schedule)\s+([a-z0-9]+)[.:\s-]*(.{0,120})$/i
// A short, mostly-uppercase line with letters is treated as a heading (Phase 6 §13: "uppercase headings").
const UPPERCASE_HEADING = /^[A-Z0-9][A-Z0-9 .,'&/()-]{3,80}$/

/**
 * Deterministic section detection (Phase 6 §13) — NO AI, NO
 * heuristic beyond pattern matching against numbered/uppercase/
 * annexure heading conventions common in SA tender documents. Every
 * page not covered by a detected heading falls into an UNKNOWN
 * section (section_number null, confidence 0) rather than being
 * silently dropped or guessed at.
 */
export function detectSections(pages: ExtractedPage[]): DetectedSection[] {
  const candidates: HeadingCandidate[] = []

  for (const page of pages) {
    const lines = page.text.split('\n')
    lines.forEach((rawLine, lineIndex) => {
      const line = rawLine.trim()
      if (line.length < 3 || line.length > 140) return

      const numbered = line.match(NUMBERED_HEADING)
      if (numbered) {
        candidates.push({
          pageNumber: page.pageNumber,
          lineIndex,
          sectionNumber: numbered[1] ?? null,
          title: (numbered[2] ?? '').trim(),
          confidence: 0.85,
        })
        return
      }

      const annexure = line.match(ANNEXURE_HEADING)
      if (annexure) {
        candidates.push({
          pageNumber: page.pageNumber,
          lineIndex,
          sectionNumber: `${capitalise(annexure[1] ?? '')} ${(annexure[2] ?? '').toUpperCase()}`,
          title: annexure[3]?.trim() || null,
          confidence: 0.8,
        })
        return
      }

      if (UPPERCASE_HEADING.test(line) && /[A-Z]{4,}/.test(line) && line === line.toUpperCase()) {
        candidates.push({
          pageNumber: page.pageNumber,
          lineIndex,
          sectionNumber: null,
          title: line,
          confidence: 0.55,
        })
      }
    })
  }

  if (pages.length === 0) return []
  const firstPageRow = pages[0]
  const lastPageRow = pages[pages.length - 1]
  if (!firstPageRow || !lastPageRow) return []

  if (candidates.length === 0) {
    return [
      {
        sectionIndex: 0,
        sectionNumber: null,
        title: null,
        pageStart: firstPageRow.pageNumber,
        pageEnd: lastPageRow.pageNumber,
        confidence: 0,
      },
    ]
  }

  const sections: DetectedSection[] = []
  const firstPage = firstPageRow.pageNumber
  const lastPage = lastPageRow.pageNumber

  const firstCandidate = candidates[0]
  // Anything before the first detected heading is UNKNOWN.
  if (firstCandidate && firstCandidate.pageNumber > firstPage) {
    sections.push({
      sectionIndex: 0,
      sectionNumber: null,
      title: null,
      pageStart: firstPage,
      pageEnd: firstCandidate.pageNumber - 1,
      confidence: 0,
    })
  }

  candidates.forEach((candidate, i) => {
    const next = candidates[i + 1]
    const pageEnd = next ? Math.max(candidate.pageNumber, next.pageNumber - (next.pageNumber > candidate.pageNumber ? 1 : 0)) : lastPage
    sections.push({
      sectionIndex: sections.length,
      sectionNumber: candidate.sectionNumber,
      title: candidate.title || null,
      pageStart: candidate.pageNumber,
      pageEnd: Math.max(pageEnd, candidate.pageNumber),
      confidence: candidate.confidence,
    })
  })

  return sections
}

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
}
