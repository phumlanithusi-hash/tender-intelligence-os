import { CHUNK_MAX_CHARS, CHUNK_TARGET_CHARS } from '@tender-os/constants'
import type { ExtractedPage } from './extractors/types.js'
import type { DetectedSection } from './sectionDetection.js'

export interface DocumentChunk {
  chunkIndex: number
  sectionIndex: number | null
  pageStart: number
  pageEnd: number
  text: string
  charCount: number
  tokenEstimate: number
}

interface Paragraph {
  pageNumber: number
  text: string
}

/**
 * Deterministic chunking (Phase 6 §14): "Prefer boundaries at
 * section/subsection/paragraph/page over arbitrary character limits;
 * use max limits only where necessary." Each detected section (from
 * sectionDetection.ts) is chunked independently — a chunk never spans
 * two sections — and within a section, chunks are built by
 * accumulating whole paragraphs up to CHUNK_TARGET_CHARS, only
 * hard-splitting a single paragraph if it alone exceeds
 * CHUNK_MAX_CHARS. Same input always produces the same chunks
 * (idempotent — Phase 6 §20/§30).
 */
export function chunkDocument(pages: ExtractedPage[], sections: DetectedSection[]): DocumentChunk[] {
  const pageByNumber = new Map(pages.map((p) => [p.pageNumber, p]))
  const chunks: DocumentChunk[] = []

  sections.forEach((section, sectionIndex) => {
    const paragraphs: Paragraph[] = []
    for (let pageNumber = section.pageStart; pageNumber <= section.pageEnd; pageNumber += 1) {
      const page = pageByNumber.get(pageNumber)
      if (!page) continue
      for (const para of splitParagraphs(page.text)) {
        paragraphs.push({ pageNumber, text: para })
      }
    }

    for (const chunk of chunkParagraphs(paragraphs)) {
      chunks.push({ ...chunk, chunkIndex: chunks.length, sectionIndex })
    }
  })

  return chunks
}

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
}

function chunkParagraphs(paragraphs: Paragraph[]): Omit<DocumentChunk, 'chunkIndex' | 'sectionIndex'>[] {
  const results: Omit<DocumentChunk, 'chunkIndex' | 'sectionIndex'>[] = []
  let buffer: string[] = []
  let bufferLen = 0
  let minPage = Infinity
  let maxPage = -Infinity

  const flush = () => {
    if (buffer.length === 0) return
    const text = buffer.join('\n\n')
    results.push({
      pageStart: minPage,
      pageEnd: maxPage,
      text,
      charCount: text.length,
      tokenEstimate: estimateTokens(text),
    })
    buffer = []
    bufferLen = 0
    minPage = Infinity
    maxPage = -Infinity
  }

  for (const para of paragraphs) {
    if (para.text.length > CHUNK_MAX_CHARS) {
      flush()
      for (const slice of hardSplit(para.text, CHUNK_MAX_CHARS)) {
        results.push({
          pageStart: para.pageNumber,
          pageEnd: para.pageNumber,
          text: slice,
          charCount: slice.length,
          tokenEstimate: estimateTokens(slice),
        })
      }
      continue
    }

    if (bufferLen + para.text.length > CHUNK_TARGET_CHARS && buffer.length > 0) {
      flush()
    }

    buffer.push(para.text)
    bufferLen += para.text.length + 2
    minPage = Math.min(minPage, para.pageNumber)
    maxPage = Math.max(maxPage, para.pageNumber)
  }
  flush()

  if (results.length === 0 && paragraphs.length === 0) return []
  return results
}

function hardSplit(text: string, maxChars: number): string[] {
  const slices: string[] = []
  for (let i = 0; i < text.length; i += maxChars) {
    slices.push(text.slice(i, i + maxChars))
  }
  return slices
}

/** Rough, deterministic token estimate (~4 chars/token) — good enough for later context-window budgeting; never used as an exact count. */
function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4))
}
