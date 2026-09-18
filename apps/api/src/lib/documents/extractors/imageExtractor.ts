import type { DocumentExtractor, ExtractionResult } from './types.js'

/**
 * A bare image file (PNG/JPEG/TIFF/BMP/WebP) has no "native" text to
 * extract at all (Phase 6 §10) — this extractor always reports
 * `ocrRequired: true` with an empty page 1 placeholder, never
 * fabricating text. The OCR stage (ocr/*) is what actually produces
 * page text for this document.
 */
export const imageExtractor: DocumentExtractor = {
  kind: 'IMAGE',
  async extract(): Promise<ExtractionResult> {
    return {
      pages: [{ pageNumber: 1, text: '', extractionMethod: 'NATIVE_TEXT', confidence: null }],
      tables: [],
      ocrRequired: true,
      warnings: ['Image file has no native text layer; OCR required.'],
    }
  },
}
