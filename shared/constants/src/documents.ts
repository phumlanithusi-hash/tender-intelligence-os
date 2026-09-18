/**
 * Phase 6 domain enums — kept in exact sync with the Postgres enum
 * types they mirror (database/migrations/20260911120000_document_pipeline.sql).
 */

export const DOCUMENT_PROCESSING_STATE = [
  'DISCOVERED',
  'DOWNLOAD_QUEUED',
  'DOWNLOADING',
  'DOWNLOADED',
  'VALIDATING',
  'VALID',
  'INVALID',
  'EXTRACTING',
  'EXTRACTED',
  'OCR_REQUIRED',
  'OCR_QUEUED',
  'OCR_PROCESSING',
  'OCR_COMPLETE',
  'OCR_FAILED',
  'SEGMENTED',
  'CHUNKED',
  'READY_FOR_ANALYSIS',
  'DOWNLOAD_FAILED',
  'EXTRACTION_FAILED',
  'FAILED',
  'REQUIRES_REVIEW',
] as const
export type DocumentProcessingState = (typeof DOCUMENT_PROCESSING_STATE)[number]

/** Terminal states from which reprocessing (Phase 6 §20) can be requested. */
export const REPROCESSABLE_STATES: readonly DocumentProcessingState[] = [
  'INVALID',
  'OCR_REQUIRED',
  'OCR_FAILED',
  'DOWNLOAD_FAILED',
  'EXTRACTION_FAILED',
  'FAILED',
  'REQUIRES_REVIEW',
  'READY_FOR_ANALYSIS',
]

export const DOCUMENT_EXTRACTION_METHOD = ['NATIVE_TEXT', 'OCR', 'STRUCTURED'] as const
export type DocumentExtractionMethod = (typeof DOCUMENT_EXTRACTION_METHOD)[number]

export const DOCUMENT_FILE_KIND = ['PDF', 'DOCX', 'XLSX', 'PPTX', 'HTML', 'TXT', 'IMAGE', 'UNKNOWN'] as const
export type DocumentFileKind = (typeof DOCUMENT_FILE_KIND)[number]

/** Deterministic classification labels (Phase 6 §23) — never AI-derived. */
export const DOCUMENT_CLASSIFICATION = [
  'TOR',
  'RFP',
  'RFQ',
  'SBD_FORM',
  'PRICING_SCHEDULE',
  'SPECIFICATION',
  'ANNEXURE',
  'ADDENDUM',
  'BRIEFING',
  'OTHER',
  'UNKNOWN',
] as const
export type DocumentClassification = (typeof DOCUMENT_CLASSIFICATION)[number]

/** Maximum file size the download stage will accept (Phase 6 §4/§32): 50 MiB. */
export const MAX_DOCUMENT_FILE_SIZE_BYTES = 50 * 1024 * 1024

/** Maximum redirect hops the download stage will follow (Phase 6 §4). */
export const MAX_DOWNLOAD_REDIRECTS = 5

/** Download stage timeout, per attempt (Phase 6 §4). */
export const DOWNLOAD_TIMEOUT_MS = 30_000

/** Maximum decompressed size guard for zip-container formats (docx/xlsx/pptx) — Phase 6 §33 decompression-bomb defence. */
export const MAX_DECOMPRESSED_SIZE_BYTES = 200 * 1024 * 1024

/** Deterministic chunker target size, in characters (Phase 6 §14). */
export const CHUNK_TARGET_CHARS = 1800
export const CHUNK_MAX_CHARS = 3000

/** A page whose native-extracted text is shorter than this (per character) is presumed to need OCR (Phase 6 §10). */
export const OCR_MIN_CHARS_PER_PAGE = 20
