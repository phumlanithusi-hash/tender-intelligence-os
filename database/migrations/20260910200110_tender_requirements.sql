-- Phase 2 §10: tender requirements — one of the most important
-- tables in the system. Every requirement is individually traceable
-- to a source document, page, and section, and its qualification
-- status against THIS agency can only be PASS when backed by a real
-- piece of agency_evidence (enforced by the CHECK constraint below,
-- not merely by application convention — see docs/AI-ARCHITECTURE.md
-- §1 and Phase 2 §10: "Do not allow AI to mark a requirement PASS
-- unless there is sufficient agency evidence.").
create table tender_requirements (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references tenders(id) on delete cascade,
  requirement_type requirement_type not null,
  requirement_text text not null,
  mandatory boolean not null default false,
  severity severity,
  source_document_id uuid references tender_documents(id),
  page_number integer,
  section_reference text,
  evidence_text text,
  confidence numeric,
  -- Pipeline status: did extraction succeed, distinct from whether the
  -- agency currently satisfies the requirement (qualification_status).
  extraction_status extraction_status not null default 'PENDING',
  -- Agency-specific: does THIS agency currently satisfy this
  -- requirement. Defaults to the safe value; never silently PASS.
  qualification_status qualification_status not null default 'UNKNOWN',
  qualification_evidence_id uuid references agency_evidence(id),
  qualification_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tender_requirements_confidence_range
    check (confidence is null or (confidence >= 0 and confidence <= 1)),
  constraint tender_requirements_page_number_positive
    check (page_number is null or page_number >= 1),
  constraint tender_requirements_pass_requires_evidence
    check (qualification_status <> 'PASS' or qualification_evidence_id is not null)
);

create index tender_requirements_tender_id_idx on tender_requirements (tender_id);
create index tender_requirements_requirement_type_idx on tender_requirements (requirement_type);
create index tender_requirements_mandatory_idx on tender_requirements (mandatory) where mandatory;
create index tender_requirements_qualification_status_idx on tender_requirements (qualification_status);
create index tender_requirements_source_document_id_idx on tender_requirements (source_document_id);

create trigger tender_requirements_set_updated_at
  before update on tender_requirements
  for each row execute function set_updated_at();
