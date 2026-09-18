import type { DocumentFileKind } from '@tender-os/constants'
import type { DocumentExtractor } from './types.js'
import { pdfExtractor } from './pdfExtractor.js'
import { docxExtractor } from './docxExtractor.js'
import { xlsxExtractor } from './xlsxExtractor.js'
import { htmlExtractor } from './htmlExtractor.js'
import { textExtractor } from './textExtractor.js'
import { imageExtractor } from './imageExtractor.js'

/**
 * Document -> extractor lookup (Phase 6 §8): "Create a pluggable
 * ExtractorRegistry... Do not embed extraction logic throughout API
 * routes." PPTX has no registered extractor — a maintained, purely-
 * parsing (never macro-executing) pure-JS PPTX text library was not
 * available to add here, and Phase 6 §33 explicitly forbids adding a
 * sketchy dependency just to check a box; a PPTX document is instead
 * routed to REQUIRES_REVIEW by the pipeline with a documented
 * limitation (docs/DOCUMENT-INGESTION.md).
 */
const registry = new Map<DocumentFileKind, DocumentExtractor>([
  ['PDF', pdfExtractor],
  ['DOCX', docxExtractor],
  ['XLSX', xlsxExtractor],
  ['HTML', htmlExtractor],
  ['TXT', textExtractor],
  ['IMAGE', imageExtractor],
])

export function getExtractor(kind: DocumentFileKind): DocumentExtractor | null {
  return registry.get(kind) ?? null
}

export function isSupportedForExtraction(kind: DocumentFileKind): boolean {
  return registry.has(kind)
}
