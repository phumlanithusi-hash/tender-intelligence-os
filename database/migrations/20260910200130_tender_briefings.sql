-- Phase 2 §12: briefings. A compulsory (mandatory) briefing is a
-- potential hard qualification blocker — the Qualification Engine
-- (application layer, later phase) reads `mandatory` and
-- `attendance_recorded` together to decide whether this becomes a
-- mandatory-failure that overrides the opportunity score.
create table tender_briefings (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references tenders(id) on delete cascade,
  mandatory boolean not null default false,
  date date,
  start_time time,
  end_time time,
  location text,
  online_url text,
  registration_required boolean not null default false,
  registration_deadline timestamptz,
  attendance_recorded boolean not null default false,
  notes text,
  source_document_id uuid references tender_documents(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tender_briefings_tender_id_idx on tender_briefings (tender_id);
create index tender_briefings_mandatory_idx on tender_briefings (mandatory) where mandatory;

create trigger tender_briefings_set_updated_at
  before update on tender_briefings
  for each row execute function set_updated_at();
