import { z } from 'zod'
import {
  DOCUMENT_PROCESSING_STATE,
  DOCUMENT_EXTRACTION_METHOD,
  DOCUMENT_FILE_KIND,
} from '@tender-os/constants'

/** Mirrors `tender_document_versions` (Phase 6 §7). */
export const tenderDocumentVersionSchema = z.object({
  id: z.string().uuid(),
  document_id: z.string().uuid(),
  tender_id: z.string().uuid(),
  source_id: z.string().uuid().nullable(),
  version: z.number().int(),
  previous_version_id: z.string().uuid().nullable(),
  original_url: z.string().nullable(),
  filename: z.string(),
  storage_path: z.string().nullable(),
  mime_type: z.string().nullable(),
  detected_file_kind: z.enum(DOCUMENT_FILE_KIND),
  file_size: z.number().nullable(),
  file_hash: z.string().nullable(),
  retrieved_at: z.string().nullable(),
  is_original: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
})
export type TenderDocumentVersionRow = z.infer<typeof tenderDocumentVersionSchema>

/** Mirrors `tender_document_processing` (Phase 6 §2). */
export const tenderDocumentProcessingSchema = z.object({
  id: z.string().uuid(),
  document_version_id: z.string().uuid(),
  state: z.enum(DOCUMENT_PROCESSING_STATE),
  download_attempts: z.number().int(),
  extraction_attempts: z.number().int(),
  ocr_attempts: z.number().int(),
  last_error: z.string().nullable(),
  last_error_stage: z.string().nullable(),
  downloaded_at: z.string().nullable(),
  extracted_at: z.string().nullable(),
  ocr_completed_at: z.string().nullable(),
  segmented_at: z.string().nullable(),
  chunked_at: z.string().nullable(),
  page_count: z.number().int().nullable(),
  extraction_method: z.enum(DOCUMENT_EXTRACTION_METHOD).nullable(),
  document_classification: z.string().nullable(),
  classification_confidence: z.number().nullable(),
  execution_id: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
})
export type TenderDocumentProcessingRow = z.infer<typeof tenderDocumentProcessingSchema>

/** Mirrors `tender_document_pages` (Phase 6 §12). */
export const tenderDocumentPageSchema = z.object({
  id: z.string().uuid(),
  document_version_id: z.string().uuid(),
  page_number: z.number().int(),
  text: z.string(),
  extraction_method: z.enum(DOCUMENT_EXTRACTION_METHOD),
  extraction_confidence: z.number().nullable(),
  char_count: z.number().int(),
  created_at: z.string(),
})
export type TenderDocumentPageRow = z.infer<typeof tenderDocumentPageSchema>

/** Mirrors `tender_document_sections` (Phase 6 §13). */
export const tenderDocumentSectionSchema = z.object({
  id: z.string().uuid(),
  document_version_id: z.string().uuid(),
  section_index: z.number().int(),
  section_number: z.string().nullable(),
  title: z.string().nullable(),
  page_start: z.number().int(),
  page_end: z.number().int(),
  confidence: z.number(),
  created_at: z.string(),
})
export type TenderDocumentSectionRow = z.infer<typeof tenderDocumentSectionSchema>

/** Mirrors `tender_document_chunks` (Phase 6 §14). */
export const tenderDocumentChunkSchema = z.object({
  id: z.string().uuid(),
  document_version_id: z.string().uuid(),
  section_id: z.string().uuid().nullable(),
  chunk_index: z.number().int(),
  page_start: z.number().int(),
  page_end: z.number().int(),
  text: z.string(),
  char_count: z.number().int(),
  token_estimate: z.number().int(),
  previous_chunk_id: z.string().uuid().nullable(),
  created_at: z.string(),
})
export type TenderDocumentChunkRow = z.infer<typeof tenderDocumentChunkSchema>
