-- Phase 2 §18: foundational bid tables. Establishes relationships
-- only — the full bid generation/red-team/compliance workflow is a
-- later phase (Phase 13+). Every table here is agency-owned.
create table bid_projects (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references tenders(id),
  agency_id uuid not null references agencies(id) on delete cascade,
  assigned_to uuid references users(id),
  decision bid_decision not null default 'UNDECIDED',
  decision_reason text,
  decided_by uuid references users(id),
  decided_at timestamptz,
  status bid_project_status not null default 'DRAFTING',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One active bid project per (tender, agency) — re-bidding after a
  -- withdrawal is a new row only if genuinely a distinct process;
  -- Phase 2 keeps this simple and revisits if that need arises.
  constraint bid_projects_tender_agency_unique unique (tender_id, agency_id)
);

create index bid_projects_agency_id_idx on bid_projects (agency_id);
create index bid_projects_tender_id_idx on bid_projects (tender_id);
create index bid_projects_status_idx on bid_projects (status);

create trigger bid_projects_set_updated_at
  before update on bid_projects
  for each row execute function set_updated_at();

create table bid_sections (
  id uuid primary key default gen_random_uuid(),
  bid_project_id uuid not null references bid_projects(id) on delete cascade,
  section_key text not null,
  title text not null,
  sort_order integer not null default 0,
  content text,
  status bid_section_status not null default 'EMPTY',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bid_sections_project_key_unique unique (bid_project_id, section_key)
);

create index bid_sections_bid_project_id_idx on bid_sections (bid_project_id);

create trigger bid_sections_set_updated_at
  before update on bid_sections
  for each row execute function set_updated_at();

-- Implements the internal bid matrix (master spec §30): tender
-- requirement -> bid section -> response/score-potential/review status.
create table bid_requirements (
  id uuid primary key default gen_random_uuid(),
  bid_project_id uuid not null references bid_projects(id) on delete cascade,
  tender_requirement_id uuid not null references tender_requirements(id),
  bid_section_id uuid references bid_sections(id),
  response_summary text,
  score_potential text,
  review_status bid_review_status not null default 'OPEN',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bid_requirements_project_requirement_unique unique (bid_project_id, tender_requirement_id)
);

create index bid_requirements_bid_project_id_idx on bid_requirements (bid_project_id);
create index bid_requirements_tender_requirement_id_idx on bid_requirements (tender_requirement_id);

create trigger bid_requirements_set_updated_at
  before update on bid_requirements
  for each row execute function set_updated_at();

-- The AGENCY EVIDENCE -> GENERATED CLAIM link in the evidence chain
-- (Phase 2 §17). claim_text is the specific factual claim drafted
-- for this bid section, citing agency_evidence_id as its proof; a
-- claim with no evidence row simply cannot exist (not null FK).
create table bid_evidence (
  id uuid primary key default gen_random_uuid(),
  bid_project_id uuid not null references bid_projects(id) on delete cascade,
  bid_section_id uuid references bid_sections(id),
  bid_requirement_id uuid references bid_requirements(id),
  agency_evidence_id uuid not null references agency_evidence(id),
  claim_text text,
  verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index bid_evidence_bid_project_id_idx on bid_evidence (bid_project_id);
create index bid_evidence_agency_evidence_id_idx on bid_evidence (agency_evidence_id);

create trigger bid_evidence_set_updated_at
  before update on bid_evidence
  for each row execute function set_updated_at();

create table bid_documents (
  id uuid primary key default gen_random_uuid(),
  bid_project_id uuid not null references bid_projects(id) on delete cascade,
  document_type text,
  filename text not null,
  storage_path text,
  file_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index bid_documents_bid_project_id_idx on bid_documents (bid_project_id);

create trigger bid_documents_set_updated_at
  before update on bid_documents
  for each row execute function set_updated_at();

create table bid_versions (
  id uuid primary key default gen_random_uuid(),
  bid_project_id uuid not null references bid_projects(id) on delete cascade,
  snapshot jsonb not null,
  milestone text,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

create index bid_versions_bid_project_id_idx on bid_versions (bid_project_id);

create table bid_reviews (
  id uuid primary key default gen_random_uuid(),
  bid_project_id uuid not null references bid_projects(id) on delete cascade,
  bid_section_id uuid references bid_sections(id),
  reviewer_id uuid references users(id),
  comment text not null,
  status bid_review_status not null default 'OPEN',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index bid_reviews_bid_project_id_idx on bid_reviews (bid_project_id);

create trigger bid_reviews_set_updated_at
  before update on bid_reviews
  for each row execute function set_updated_at();

create table bid_submissions (
  id uuid primary key default gen_random_uuid(),
  bid_project_id uuid not null references bid_projects(id) on delete cascade,
  submitted_at timestamptz,
  submitted_by uuid references users(id),
  method text,
  confirmation_reference text,
  compliance_state_at_submission compliance_state,
  created_at timestamptz not null default now(),
  constraint bid_submissions_bid_project_id_unique unique (bid_project_id)
);
