-- Phase 2 §17: evidence model.
-- TENDER REQUIREMENT -> BID SECTION -> AGENCY EVIDENCE -> GENERATED CLAIM
--
-- agency_evidence is the single, normalised place every other table
-- points to when it needs to cite proof of an agency capability or
-- credential. It is deliberately polymorphic (exactly one of the
-- specific FKs is set) rather than five separate loosely-related
-- evidence concepts, so a requirement's qualification_evidence_id
-- (added in the tenders_core/requirements migration) and a bid's
-- claims (bid architecture migration) can all reference proof the
-- same, single way regardless of what kind of proof it is.
create table agency_evidence (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  evidence_type evidence_type not null,
  case_study_id uuid references agency_case_studies(id),
  document_id uuid references agency_documents(id),
  certificate_id uuid references agency_certificates(id),
  team_member_id uuid references agency_team(id),
  reference_id uuid references agency_references(id),
  policy_id uuid references agency_policies(id),
  description text,
  evidence_status evidence_status not null default 'UNVERIFIED',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agency_evidence_exactly_one_target check (
    (case when case_study_id is not null then 1 else 0 end)
    + (case when document_id is not null then 1 else 0 end)
    + (case when certificate_id is not null then 1 else 0 end)
    + (case when team_member_id is not null then 1 else 0 end)
    + (case when reference_id is not null then 1 else 0 end)
    + (case when policy_id is not null then 1 else 0 end)
    = 1
  )
);

create index agency_evidence_agency_id_idx on agency_evidence (agency_id);
create index agency_evidence_case_study_id_idx on agency_evidence (case_study_id) where case_study_id is not null;
create index agency_evidence_document_id_idx on agency_evidence (document_id) where document_id is not null;

create trigger agency_evidence_set_updated_at
  before update on agency_evidence
  for each row execute function set_updated_at();
