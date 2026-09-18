import type { DocumentExtractionMethod, DocumentFileKind } from '@tender-os/constants'

/** One page's worth of extracted text plus how it was produced (Phase 6 §9/§12). */
export interface ExtractedPage {
  pageNumber: number
  text: string
  extractionMethod: DocumentExtractionMethod
  /** 0-1 confidence where the extraction method can report one (e.g. OCR); null for native text extraction, which has no meaningful confidence score. */
  confidence: number | null
}

/** A preserved table (Phase 6 §21) — never flattened to unreadable text where the source format keeps real structure. */
export interface ExtractedTable {
  pageNumber: number
  rows: string[][]
}

export interface ExtractionResult {
  pages: ExtractedPage[]
  tables: ExtractedTable[]
  /** True when native extraction produced too little text to be usable and OCR should be attempted (Phase 6 §10). */
  ocrRequired: boolean
  warnings: string[]
}

export interface DocumentExtractor {
  readonly kind: DocumentFileKind
  extract(bytes: Buffer): Promise<ExtractionResult>
}
