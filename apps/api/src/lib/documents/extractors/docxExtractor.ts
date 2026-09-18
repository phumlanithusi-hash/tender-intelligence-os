import mammoth from 'mammoth'
import { assertZipNotABomb } from '../zipGuard.js'
import type { DocumentExtractor, ExtractionResult } from './types.js'

/**
 * DOCX text extraction (Phase 6 §9/§33). Mammoth parses the OOXML
 * document.xml as data — it never executes macros or embedded content
 * (DOCX macros live in VBA project parts mammoth doesn't touch at
 * all), matching Phase 6 §33's "treat as data only".
 *
 * DOCX has no native concept of a fixed page (pagination is a
 * rendering-time computation, not stored in the document), so the
 * whole document is treated as a single logical page (page 1) —
 * documented limitation, not a bug: Phase 7's evidence linkage can
 * still cite "Page 1" plus the deterministic section detected within
 * it (headings survive as plain paragraph text via extractRawText).
 */
export const docxExtractor: DocumentExtractor = {
  kind: 'DOCX',
  async extract(bytes: Buffer): Promise<ExtractionResult> {
    assertZipNotABomb(bytes)
    const result = await mammoth.extractRawText({ buffer: bytes })
    const text = result.value ?? ''
    const warnings = (result.messages ?? []).map((m) => m.message)

    return {
      pages: [{ pageNumber: 1, text, extractionMethod: 'NATIVE_TEXT', confidence: null }],
      tables: [],
      ocrRequired: false,
      warnings,
    }
  },
}
