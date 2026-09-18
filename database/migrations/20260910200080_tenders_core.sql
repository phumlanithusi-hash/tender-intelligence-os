-- Phase 2 §5: the canonical tender record. One row per real-world
-- tender, regardless of how many sources it was discovered on
-- (tender_source_records below holds the per-source appearances).
--
-- Nullable is the default for anything not yet known — never invented
-- (master spec §3, Phase 2 §5: "Do NOT store fabricated values.
-- Nullable values are preferable to invented information.").
create table tenders (
  id uuid primary key default gen_random_uuid(),
  tender_number text,
  title text not null,
  organisation text,
  entity_type text,
  -- Denormalised display/query columns. The authoritative, structured
  -- geographic relationship lives in tender_geographic_scope
  -- (Phase 2 §7) — these two columns are a convenience label only and
  -- are not treated as a foreign key or validated against the
  -- reference tables, since a source may describe a location more
  -- loosely than the reference data can resolve.
  province text,
  municipality text,
  category text,
  description text,
  published_date date,
  closing_date date,
  closing_time time,
  briefing_required boolean not null default false,
  briefing_date date,
  briefing_location text,
  briefing_url text,
  estimated_value numeric,
  contract_duration text,
  submission_method text,
  submission_url text,
  submission_email text,
  original_document_url text,
  status tender_status not null default 'DISCOVERED',
  confidence_score numeric,
  discovered_at timestamptz not null default now(),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenders_confidence_score_range
    check (confidence_score is null or (confidence_score >= 0 and confidence_score <= 1)),
  constraint tenders_estimated_value_non_negative
    check (estimated_value is null or estimated_value >= 0),
  -- Catches the common real-world duplicate signal (same number issued
  -- by the same organisation) without forbidding two different
  -- organisations from legitimately reusing a numbering scheme, and
  -- without forbidding a tender_number-less record (many sources omit it).
  constraint tenders_number_per_organisation_unique
    unique (tender_number, organisation)
);

create index tenders_status_idx on tenders (status);
create index tenders_closing_date_idx on tenders (closing_date);
create index tenders_organisation_idx on tenders (organisation);
create index tenders_category_idx on tenders (category);
create index tenders_province_idx on tenders (province);

create trigger tenders_set_updated_at
  before update on tenders
  for each row execute function set_updated_at();

-- Phase 2 §4: source-specific appearance of a tender. Multiple rows
-- (from different sources, or the same source re-scraped) can point
-- at one canonical tender. The canonical record is the merge target;
-- this table is the audit trail for how that merge decision was made
-- and what the source actually said verbatim.
create table tender_source_records (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid references tenders(id) on delete set null,
  source_id uuid not null references tender_sources(id),
  external_id text,
  source_url text,
  discovered_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  source_status source_record_status not null default 'ACTIVE',
  raw_title text,
  raw_description text,
  raw_closing_date text,
  raw_closing_time text,
  raw_organisation text,
  raw_data jsonb,
  content_hash text,
  document_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Prevents re-ingesting the exact same source-native record as a
  -- second row on every scan; a genuine update to that same listing
  -- updates last_seen_at/content_hash on the existing row instead.
  constraint tender_source_records_source_external_unique
    unique (source_id, external_id)
);

create index tender_source_records_tender_id_idx on tender_source_records (tender_id);
create index tender_source_records_source_id_idx on tender_source_records (source_id);
create index tender_source_records_content_hash_idx on tender_source_records (content_hash);

create trigger tender_source_records_set_updated_at
  before update on tender_source_records
  for each row execute function set_updated_at();
