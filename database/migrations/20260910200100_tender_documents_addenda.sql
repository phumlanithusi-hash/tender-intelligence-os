-- Phase 2 §8: tender documents.
create table tender_documents (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references tenders(id) on delete cascade,
  source_id uuid references tender_sources(id),
  document_type document_type not null default 'OTHER',
  filename text not null,
  file_url text,
  storage_path text,
  mime_type text,
  file_size bigint,
  file_hash text,
  version integer not null default 1,
  published_at timestamptz,
  downloaded_at timestamptz,
  is_original boolean not null default true,
  is_addendum boolean not null default false,
  extraction_status extraction_status not null default 'PENDING',
  ocr_required boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tender_documents_file_size_non_negative check (file_size is null or file_size >= 0),
  constraint tender_documents_version_positive check (version >= 1),
  -- Prevents storing the exact same file twice against the same
  -- tender; a genuinely new version must have a different hash.
  constraint tender_documents_tender_hash_unique unique (tender_id, file_hash)
);

create index tender_documents_tender_id_idx on tender_documents (tender_id);
create index tender_documents_source_id_idx on tender_documents (source_id);
create index tender_documents_extraction_status_idx on tender_documents (extraction_status);
create index tender_documents_is_addendum_idx on tender_documents (is_addendum) where is_addendum;

create trigger tender_documents_set_updated_at
  before update on tender_documents
  for each row execute function set_updated_at();

-- Phase 2 §9: addenda. An addendum record only asserts a change once
-- the documents confirm it — the four boolean "changed" flags default
-- false and are set true only on confirmed evidence (Phase 2 §9: "Do
-- not assume an addendum changes anything until the documents confirm it").
create table tender_addenda (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references tenders(id) on delete cascade,
  document_id uuid not null references tender_documents(id),
  addendum_number integer not null,
  published_at timestamptz,
  summary text,
  deadline_changed boolean not null default false,
  briefing_changed boolean not null default false,
  requirement_changed boolean not null default false,
  evaluation_changed boolean not null default false,
  pricing_changed boolean not null default false,
  other_changes text,
  created_at timestamptz not null default now(),
  constraint tender_addenda_number_positive check (addendum_number >= 1),
  constraint tender_addenda_tender_number_unique unique (tender_id, addendum_number)
);

create index tender_addenda_tender_id_idx on tender_addenda (tender_id);
create index tender_addenda_document_id_idx on tender_addenda (document_id);
