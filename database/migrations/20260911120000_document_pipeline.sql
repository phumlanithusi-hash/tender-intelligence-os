-- Phase 6: Tender Document Ingestion & Evidence Pipeline.
--
-- Builds on the Phase 2 `tender_documents` table (kept as the
-- canonical "one row per known document identity" record — Phase 6
-- §16: "Use existing tender_documents where appropriate") and adds
-- only the smallest set of new tables needed to carry a document
-- through DOWNLOAD -> VALIDATE -> HASH -> STORE -> EXTRACT -> OCR ->
-- SEGMENT -> SECTION DETECT -> CHUNK with full provenance:
--
--   tender_documents            (existing) one row per document
--                                identity (latest known metadata).
--   tender_document_versions    one row per physical file ever seen
--                                for a document identity — preserves
--                                "a later version must never erase
--                                the original" (Phase 6 §7).
--   tender_document_processing  one row per version: the explicit
--                                lifecycle/status state machine
--                                (Phase 6 §2), retry/failure history.
--   tender_document_pages       page-level extracted text + method +
--                                confidence (Phase 6 §12).
--   tender_document_sections    deterministically detected sections
--                                (Phase 6 §13).
--   tender_document_chunks      deterministic chunks for later AI
--                                consumption (Phase 6 §14).
--
-- RLS follows the Phase 2/4 shared-catalogue pattern used for
-- `tender_documents` itself: select for any authenticated user,
-- writes only via the privileged service-role client (no
-- insert/update/delete policy for `authenticated` at all — see
-- 20260910200180_rls_policies.sql's doc comment on why the absence of
-- a policy is sufficient under RLS).

-- ---------------------------------------------------------------
-- New enums.
-- ---------------------------------------------------------------

-- The explicit document processing lifecycle (Phase 6 §2). Deliberately
-- NOT collapsed into `extraction_status` (Phase 2) — that column stays
-- as the coarse, tender-detail-facing summary; this is the fine-grained
-- state machine the pipeline itself drives.
create type document_processing_state as enum (
  'DISCOVERED', 'DOWNLOAD_QUEUED', 'DOWNLOADING', 'DOWNLOADED',
  'VALIDATING', 'VALID', 'INVALID',
  'EXTRACTING', 'EXTRACTED',
  'OCR_REQUIRED', 'OCR_QUEUED', 'OCR_PROCESSING', 'OCR_COMPLETE', 'OCR_FAILED',
  'SEGMENTED', 'CHUNKED', 'READY_FOR_ANALYSIS',
  'DOWNLOAD_FAILED', 'EXTRACTION_FAILED', 'FAILED', 'REQUIRES_REVIEW'
);

-- How a page's text came to exist — never ambiguous between the two
-- (Phase 6 §11: "OCR output must remain distinguishable from native
-- extracted text").
create type document_extraction_method as enum ('NATIVE_TEXT', 'OCR', 'STRUCTURED');

create type document_file_kind as enum (
  'PDF', 'DOCX', 'XLSX', 'PPTX', 'HTML', 'TXT', 'IMAGE', 'UNKNOWN'
);

-- ---------------------------------------------------------------
-- tender_document_versions: one row per physical file ever retrieved
-- for a tender_documents identity (Phase 6 §6/§7).
-- ---------------------------------------------------------------
create table tender_document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references tender_documents(id) on delete cascade,
  tender_id uuid not null references tenders(id) on delete cascade,
  source_id uuid references tender_sources(id),
  version integer not null,
  previous_version_id uuid references tender_document_versions(id),
  original_url text,
  filename text not null,
  storage_path text,
  mime_type text,
  detected_file_kind document_file_kind not null default 'UNKNOWN',
  file_size bigint,
  file_hash text,
  retrieved_at timestamptz,
  is_original boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tender_document_versions_version_positive check (version >= 1),
  constraint tender_document_versions_file_size_non_negative check (file_size is null or file_size >= 0),
  constraint tender_document_versions_document_version_unique unique (document_id, version),
  -- Deduplication (Phase 6 §6): the same file hash for the same
  -- document identity is never stored twice as a distinct version.
  constraint tender_document_versions_document_hash_unique unique (document_id, file_hash)
);

create index tender_document_versions_document_id_idx on tender_document_versions (document_id);
create index tender_document_versions_tender_id_idx on tender_document_versions (tender_id);
create index tender_document_versions_file_hash_idx on tender_document_versions (file_hash);

create trigger tender_document_versions_set_updated_at
  before update on tender_document_versions
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------
-- tender_document_processing: the lifecycle state machine + retry
-- history for one document version (Phase 6 §2/§19/§20). One row per
-- version — reprocessing updates this row in place rather than
-- inserting a duplicate, so processing history (attempt counts,
-- last error) survives reprocessing without ever losing the original
-- document record (Phase 6 §18: "A failed stage must not cause the
-- original document record to disappear").
-- ---------------------------------------------------------------
create table tender_document_processing (
  id uuid primary key default gen_random_uuid(),
  document_version_id uuid not null references tender_document_versions(id) on delete cascade,
  state document_processing_state not null default 'DISCOVERED',
  download_attempts integer not null default 0,
  extraction_attempts integer not null default 0,
  ocr_attempts integer not null default 0,
  last_error text,
  last_error_stage text,
  downloaded_at timestamptz,
  extracted_at timestamptz,
  ocr_completed_at timestamptz,
  segmented_at timestamptz,
  chunked_at timestamptz,
  page_count integer,
  extraction_method document_extraction_method,
  document_classification text,
  classification_confidence numeric,
  execution_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tender_document_processing_version_unique unique (document_version_id),
  constraint tender_document_processing_attempts_non_negative check (
    download_attempts >= 0 and extraction_attempts >= 0 and ocr_attempts >= 0
  )
);

create index tender_document_processing_state_idx on tender_document_processing (state);

create trigger tender_document_processing_set_updated_at
  before update on tender_document_processing
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------
-- tender_document_pages (Phase 6 §12). Deterministic id per
-- (document_version_id, page_number) via the unique constraint below
-- lets reprocessing use upsert semantics instead of ever accumulating
-- duplicate pages (Phase 6 §20).
-- ---------------------------------------------------------------
create table tender_document_pages (
  id uuid primary key default gen_random_uuid(),
  document_version_id uuid not null references tender_document_versions(id) on delete cascade,
  page_number integer not null,
  text text not null default '',
  extraction_method document_extraction_method not null,
  extraction_confidence numeric,
  char_count integer not null default 0,
  created_at timestamptz not null default now(),
  constraint tender_document_pages_page_number_positive check (page_number >= 1),
  constraint tender_document_pages_version_page_unique unique (document_version_id, page_number)
);

create index tender_document_pages_version_id_idx on tender_document_pages (document_version_id);

-- ---------------------------------------------------------------
-- tender_document_sections (Phase 6 §13). Deterministic detection
-- only. `section_number` is free text ("3.2", "ANNEXURE A") since
-- procurement numbering schemes vary; UNKNOWN sections carry
-- section_number = null and confidence = 0.
-- ---------------------------------------------------------------
create table tender_document_sections (
  id uuid primary key default gen_random_uuid(),
  document_version_id uuid not null references tender_document_versions(id) on delete cascade,
  section_index integer not null,
  section_number text,
  title text,
  page_start integer not null,
  page_end integer not null,
  confidence numeric not null default 0,
  created_at timestamptz not null default now(),
  constraint tender_document_sections_page_range check (page_end >= page_start),
  constraint tender_document_sections_confidence_range check (confidence >= 0 and confidence <= 1),
  constraint tender_document_sections_version_index_unique unique (document_version_id, section_index)
);

create index tender_document_sections_version_id_idx on tender_document_sections (document_version_id);

-- ---------------------------------------------------------------
-- tender_document_chunks (Phase 6 §14). `chunk_index` is deterministic
-- and stable across reprocessing runs given the same pages/sections,
-- so reprocessing can upsert on (document_version_id, chunk_index)
-- rather than accumulate duplicates (Phase 6 §20). `section_id` is
-- nullable — a chunk may fall in an UNKNOWN section.
-- ---------------------------------------------------------------
create table tender_document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_version_id uuid not null references tender_document_versions(id) on delete cascade,
  section_id uuid references tender_document_sections(id) on delete set null,
  chunk_index integer not null,
  page_start integer not null,
  page_end integer not null,
  text text not null,
  char_count integer not null,
  token_estimate integer not null,
  previous_chunk_id uuid references tender_document_chunks(id),
  created_at timestamptz not null default now(),
  constraint tender_document_chunks_page_range check (page_end >= page_start),
  constraint tender_document_chunks_version_index_unique unique (document_version_id, chunk_index)
);

create index tender_document_chunks_version_id_idx on tender_document_chunks (document_version_id);
create index tender_document_chunks_section_id_idx on tender_document_chunks (section_id);

-- ---------------------------------------------------------------
-- tender_documents: additive columns only (Phase 6 §16 — "review the
-- existing schema... use existing tables where appropriate"). Points
-- at the CURRENT version so a reader who only wants "the latest" never
-- has to know the versioning table exists.
-- ---------------------------------------------------------------
alter table tender_documents
  add column current_version_id uuid references tender_document_versions(id),
  add column classification text;

comment on column tender_documents.current_version_id is
  'The latest tender_document_versions row for this document identity (Phase 6 §7). Null until a version has been downloaded.';
comment on column tender_documents.classification is
  'Deterministic document classification (Phase 6 §23) — TOR/RFP/RFQ/SBD_FORM/etc, or UNKNOWN. Never AI-derived in this phase.';

-- ---------------------------------------------------------------
-- RLS: shared-catalogue pattern (Phase 2 §25 / Phase 4 pattern) —
-- select for any authenticated user, no authenticated write policy
-- (service-role only).
-- ---------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'tender_document_versions', 'tender_document_processing',
    'tender_document_pages', 'tender_document_sections', 'tender_document_chunks'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy %I on %I for select to authenticated using (true)',
      t || '_select_authenticated', t
    );
  end loop;
end $$;
