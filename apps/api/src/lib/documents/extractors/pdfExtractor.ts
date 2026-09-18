import { PDFParse } from 'pdf-parse'
import { OCR_MIN_CHARS_PER_PAGE } from '@tender-os/constants'
import type { DocumentExtractor, ExtractionResult } from './types.js'

/**
 * PDF text extraction (Phase 6 §9). Preserves page number and native
 * text per page. pdf-parse's text order follows the PDF's content
 * stream order, which is not always visual reading order for complex
 * layouts (multi-column, floating text boxes) — Phase 6 §9 explicitly
 * accepts this ("do not assume PDF text order is perfect"); no
 * layout-reconstruction is attempted this phase.
 *
 * A malformed/unparsable PDF surfaces as a thrown error, which the
 * pipeline (pipeline.ts) turns into the INVALID processing state —
 * never silently produces an empty successful result for a corrupt
 * file (Phase 6 §19).
 */
export const pdfExtractor: DocumentExtractor = {
  kind: 'PDF',
  async extract(bytes: Buffer): Promise<ExtractionResult> {
    const parser = new PDFParse({ data: bytes })
    try {
      const result = await parser.getText()
      const pages = result.pages.map((page) => ({
        pageNumber: page.num,
        text: page.text ?? '',
        extractionMethod: 'NATIVE_TEXT' as const,
        confidence: null,
      }))

      const warnings: string[] = []
      if (pages.length === 0) {
        warnings.push('PDF reported zero pages.')
      }

      // A page is presumed scanned/image-only if its native text is
      // essentially empty (Phase 6 §10) — the pipeline decides what
      // to do with `ocrRequired`; this extractor only detects it.
      const insufficientPages = pages.filter((p) => p.text.trim().length < OCR_MIN_CHARS_PER_PAGE)
      const ocrRequired = pages.length > 0 && insufficientPages.length / pages.length >= 0.5

      return { pages, tables: [], ocrRequired, warnings }
    } finally {
      await parser.destroy()
    }
  },
}
