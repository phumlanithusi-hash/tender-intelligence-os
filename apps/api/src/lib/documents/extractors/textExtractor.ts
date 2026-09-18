import type { DocumentExtractor, ExtractionResult } from './types.js'

/** Plain text passthrough (Phase 6 §9) — decoded as UTF-8, treated as a single page. */
export const textExtractor: DocumentExtractor = {
  kind: 'TXT',
  async extract(bytes: Buffer): Promise<ExtractionResult> {
    const text = bytes.toString('utf8')
    return {
      pages: [{ pageNumber: 1, text, extractionMethod: 'NATIVE_TEXT', confidence: null }],
      tables: [],
      ocrRequired: false,
      warnings: [],
    }
  },
}
