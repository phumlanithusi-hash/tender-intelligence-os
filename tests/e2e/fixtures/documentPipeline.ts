/**
 * Controlled fixtures for the Phase 6 document evidence pipeline E2E
 * flow — synthetic only, mirroring tests/e2e/fixtures/tenders.ts's
 * own fixture tender identity so this spec can reuse it.
 */
import { FIXTURE_TENDER_SCORED } from './tenders.js'

export const FIXTURE_DOCUMENT_ID = '00000000-0000-4000-8000-0000000000d1'
export const FIXTURE_VERSION_ID = '00000000-0000-4000-8000-0000000000d2'

export const FIXTURE_DOCUMENT = {
  id: FIXTURE_DOCUMENT_ID,
  tender_id: FIXTURE_TENDER_SCORED.id,
  source_id: null,
  document_type: 'RFP',
  filename: 'e2e-fixture-rfp.pdf',
  file_url: 'https://example-etenders.test/e2e-fixture-rfp.pdf',
  storage_path: `tenders/${FIXTURE_TENDER_SCORED.id}/documents/${FIXTURE_DOCUMENT_ID}/v1/e2e-fixture-rfp.pdf`,
  mime_type: 'application/pdf',
  file_size: 2048,
  file_hash: 'e2efixturehash0000000000000000000000000000000000000000000000',
  version: 1,
  published_at: '2026-08-01T00:00:00.000Z',
  downloaded_at: '2026-08-01T00:05:00.000Z',
  is_original: true,
  is_addendum: false,
  extraction_status: 'EXTRACTED',
  ocr_required: false,
  current_version_id: FIXTURE_VERSION_ID,
  classification: 'RFP',
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:05:00.000Z',
}

export const FIXTURE_VERSION = {
  id: FIXTURE_VERSION_ID,
  document_id: FIXTURE_DOCUMENT_ID,
  tender_id: FIXTURE_TENDER_SCORED.id,
  source_id: null,
  version: 1,
  previous_version_id: null,
  original_url: FIXTURE_DOCUMENT.file_url,
  filename: FIXTURE_DOCUMENT.filename,
  storage_path: FIXTURE_DOCUMENT.storage_path,
  mime_type: 'application/pdf',
  detected_file_kind: 'PDF',
  file_size: 2048,
  file_hash: FIXTURE_DOCUMENT.file_hash,
  retrieved_at: '2026-08-01T00:05:00.000Z',
  is_original: true,
  created_at: '2026-08-01T00:05:00.000Z',
  updated_at: '2026-08-01T00:05:10.000Z',
}

export const FIXTURE_PROCESSING = {
  id: '00000000-0000-4000-8000-0000000000d3',
  document_version_id: FIXTURE_VERSION_ID,
  state: 'READY_FOR_ANALYSIS',
  download_attempts: 1,
  extraction_attempts: 1,
  ocr_attempts: 0,
  last_error: null,
  last_error_stage: null,
  downloaded_at: '2026-08-01T00:05:00.000Z',
  extracted_at: '2026-08-01T00:05:05.000Z',
  ocr_completed_at: null,
  segmented_at: '2026-08-01T00:05:06.000Z',
  chunked_at: '2026-08-01T00:05:07.000Z',
  page_count: 1,
  extraction_method: 'NATIVE_TEXT',
  document_classification: 'RFP',
  classification_confidence: 0.75,
  execution_id: null,
  created_at: '2026-08-01T00:05:00.000Z',
  updated_at: '2026-08-01T00:05:07.000Z',
}

export const FIXTURE_PAGES = [
  {
    id: '00000000-0000-4000-8000-0000000000d4',
    document_version_id: FIXTURE_VERSION_ID,
    page_number: 1,
    text: '1. INTRODUCTION\n\nSynthetic fixture RFP text used only by the Phase 6 document pipeline E2E test.',
    extraction_method: 'NATIVE_TEXT',
    extraction_confidence: null,
    char_count: 97,
    created_at: '2026-08-01T00:05:06.000Z',
  },
]

export const FIXTURE_SECTIONS = [
  {
    id: '00000000-0000-4000-8000-0000000000d5',
    document_version_id: FIXTURE_VERSION_ID,
    section_index: 0,
    section_number: '1',
    title: 'INTRODUCTION',
    page_start: 1,
    page_end: 1,
    confidence: 0.85,
    created_at: '2026-08-01T00:05:06.000Z',
  },
]

export const FIXTURE_ME_ADMIN = {
  id: '00000000-0000-4000-8000-0000000000e2',
  email: 'e2e-fixture@tender-os.test',
  role: 'ADMIN',
  agencyId: null,
  fullName: 'E2E Fixture Admin',
}
