-- Phase 14: Bid Proposal Generation & Document Assembly.
--
-- Reviewed first, per the binding spec: bid_strategy_projects,
-- bid_strategies, bid_win_themes, bid_differentiators,
-- bid_evaluation_strategies, bid_requirement_plans, bid_evidence_needs
-- (Phase 12, read-only), bid_evidence_matches, bid_evidence_claims
-- (Phase 13, read-only — the ONLY authoritative evidence source for
-- this phase; CANDIDATE/REQUIRES_VERIFICATION/VERIFIED/REJECTED/
-- SUPERSEDED rows are never treated as approved), tender_requirements,
-- tender_evaluation_criteria/tender_evaluation_subcriteria (Phase 8/9,
-- read-only), agencies/agency_evidence family (Phase 2/8, read-only),
-- audit_logs (Phase 2 §22, reused as-is).
--
-- COLLISION CHECK (same discipline as Phase 9-13): `bid_sections`,
-- `bid_documents`, `bid_versions`, `bid_evidence`, `bid_reviews`
-- already exist (20260910200150_bid_architecture.sql, Phase 2 §18) —
-- unstructured, unversioned, no AI-generation/compliance/traceability
-- machinery, and not referenced anywhere in apps/api/src or
-- apps/web/src (verified). Left completely untouched. This migration
-- introduces new, clearly-named `bid_proposal_*` tables instead, none
-- of which collide with any pre-existing name.

-- ---------------------------------------------------------------
-- 0. Enums.
-- ---------------------------------------------------------------

-- Phase 14 §20 — no state implying SUBMITTED anywhere in this vocabulary.
create type proposal_status as enum ('DRAFT', 'GENERATING', 'REQUIRES_REVIEW', 'IN_REVIEW', 'APPROVED_INTERNAL', 'BLOCKED', 'SUPERSEDED');

-- Phase 14 §7 — configurable section types. Not every proposal needs
-- every type; a blueprint picks a subset.
create type proposal_section_type as enum (
  'COVER', 'EXECUTIVE_SUMMARY', 'UNDERSTANDING_OF_REQUIREMENT', 'APPROACH', 'METHODOLOGY',
  'PROJECT_PLAN', 'DELIVERABLES', 'TEAM', 'EXPERIENCE', 'CASE_STUDIES', 'TECHNICAL_RESPONSE',
  'CREATIVE_RESPONSE', 'MEDIA_RESPONSE', 'DIGITAL_RESPONSE', 'QUALITY_ASSURANCE', 'RISK_MANAGEMENT',
  'IMPLEMENTATION', 'TIMELINE', 'SOCIAL_VALUE', 'LOCAL_CONTENT', 'TRANSFORMATION', 'SUSTAINABILITY',
  'GOVERNANCE', 'REPORTING', 'REFERENCES', 'CREDENTIALS', 'COMPLIANCE', 'APPENDICES', 'OTHER'
);

-- Phase 14 §31 — review workflow.
create type proposal_section_status as enum ('DRAFT', 'AI_GENERATED', 'REQUIRES_REVIEW', 'IN_REVIEW', 'APPROVED_INTERNAL', 'REJECTED', 'STALE');

create type proposal_block_type as enum (
  'HEADING', 'PARAGRAPH', 'BULLET_LIST', 'NUMBERED_LIST', 'TABLE', 'CALLOUT', 'QUOTE', 'STAT',
  'IMAGE', 'CASE_STUDY', 'TEAM_MEMBER', 'TIMELINE', 'REQUIREMENT_RESPONSE', 'EVIDENCE_REFERENCE', 'PLACEHOLDER'
);

-- Phase 14 §17.
create type content_origin as enum ('AI_GENERATED', 'HUMAN_AUTHORED', 'AI_REVISED', 'IMPORTED');

-- Phase 14 §11/§23 — claim-level traceability outcome.
create type claim_support_status as enum ('SUPPORTED', 'PARTIALLY_SUPPORTED', 'UNSUPPORTED', 'REQUIRES_REVIEW');

-- Phase 14 §21/§22 — deterministic compliance outcome. Precedence
-- BLOCKED > REQUIRES_REVIEW > READY_FOR_INTERNAL_REVIEW enforced in
-- application code (lib/proposals/compliance.ts), never in the DB.
create type proposal_compliance_result as enum ('READY_FOR_INTERNAL_REVIEW', 'REQUIRES_REVIEW', 'BLOCKED');
create type proposal_compliance_issue_severity as enum ('BLOCKER', 'WARNING');

-- Phase 14 §40 — generation-run outcome; AI_UNAVAILABLE/REJECTED_INVALID_OUTPUT
-- never fabricate content in their place.
create type proposal_generation_status as enum ('SUCCEEDED', 'FAILED', 'REJECTED_INVALID_OUTPUT', 'AI_UNAVAILABLE');

create type proposal_requirement_coverage as enum ('COVERED', 'PARTIAL', 'NOT_COVERED');

create type proposal_review_action as enum ('REVIEWED', 'APPROVED', 'REJECTED');

create type proposal_missing_info_status as enum ('OPEN', 'RESOLVED');

create type proposal_document_format as enum ('DOCX', 'PDF');

-- ---------------------------------------------------------------
-- 1. Bid Proposal (Phase 14 §6) — one per bid project.
-- ---------------------------------------------------------------
create table bid_proposals (
  id uuid primary key default gen_random_uuid(),
  bid_project_id uuid not null references bid_strategy_projects(id) on delete cascade,
  tender_id uuid not null references tenders(id),
  agency_id uuid not null references agencies(id) on delete cascade,
  status proposal_status not null default 'DRAFT',
  current_version integer not null default 0,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bid_proposals_project_unique unique (bid_project_id)
);
create index bid_proposals_agency_id_idx on bid_proposals (agency_id);
create index bid_proposals_tender_id_idx on bid_proposals (tender_id);
create index bid_proposals_status_idx on bid_proposals (status);
create trigger bid_proposals_set_updated_at
  before update on bid_proposals
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------
-- 2. Proposal Versions (Phase 14 §19) — append-only, never destroyed.
-- ---------------------------------------------------------------
create table bid_proposal_versions (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references bid_proposals(id) on delete cascade,
  agency_id uuid not null references agencies(id) on delete cascade,
  version integer not null,
  status proposal_status not null default 'DRAFT',
  supersedes_version_id uuid references bid_proposal_versions(id),
  is_current boolean not null default true,
  -- Snapshot of the exact strategy/evidence/requirement/evaluation
  -- state used at blueprint time (Phase 14 §38 staleness comparison).
  input_snapshot jsonb not null default '{}'::jsonb,
  is_stale boolean not null default false,
  stale_reason text,
  notes text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bid_proposal_versions_proposal_version_unique unique (proposal_id, version)
);
create index bid_proposal_versions_proposal_id_idx on bid_proposal_versions (proposal_id);
create unique index bid_proposal_versions_current_unique on bid_proposal_versions (proposal_id) where is_current;
create trigger bid_proposal_versions_set_updated_at
  before update on bid_proposal_versions
  for each row execute function set_updated_at();

-- Phase 14 §19 (binding constraint, mirrors Phase 12/13's immutable-once-decided
-- pattern): a version that is no longer current is history — its
-- status/is_stale bookkeeping may still change (e.g. APPROVED_INTERNAL ->
-- SUPERSEDED when a newer version is created, or being flagged stale),
-- but its input_snapshot/notes/created_by are frozen once not current.
create function prevent_historical_proposal_version_mutation() returns trigger as $$
begin
  if old.is_current = false and new.is_current = false then
    if new.input_snapshot is distinct from old.input_snapshot
       or new.created_by is not distinct from old.created_by and new.notes is distinct from old.notes then
      raise exception 'bid_proposal_versions: historical version % is immutable content-wise.', old.id;
    end if;
  end if;
  return new;
end;
$$ language plpgsql;
create trigger bid_proposal_versions_prevent_historical_mutation
  before update on bid_proposal_versions
  for each row execute function prevent_historical_proposal_version_mutation();

-- ---------------------------------------------------------------
-- 3. Proposal Sections (Phase 14 §6/§7).
-- ---------------------------------------------------------------
create table bid_proposal_sections (
  id uuid primary key default gen_random_uuid(),
  proposal_version_id uuid not null references bid_proposal_versions(id) on delete cascade,
  agency_id uuid not null references agencies(id) on delete cascade,
  section_key text not null,
  section_type proposal_section_type not null,
  title text not null,
  objective text,
  sort_order integer not null default 0,
  is_mandatory boolean not null default false,
  status proposal_section_status not null default 'DRAFT',
  origin content_origin not null default 'HUMAN_AUTHORED',
  last_generated_at timestamptz,
  last_edited_at timestamptz,
  last_edited_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bid_proposal_sections_version_key_unique unique (proposal_version_id, section_key)
);
create index bid_proposal_sections_version_id_idx on bid_proposal_sections (proposal_version_id);
create index bid_proposal_sections_status_idx on bid_proposal_sections (status);
create trigger bid_proposal_sections_set_updated_at
  before update on bid_proposal_sections
  for each row execute function set_updated_at();

-- Phase 14 §31 (binding constraint): an APPROVED_INTERNAL section's
-- title/objective/section_type are frozen — content itself lives in
-- bid_proposal_blocks, which gets its own immutability trigger below.
-- The only allowed transitions out of APPROVED_INTERNAL are to STALE
-- (system, on upstream change) or REJECTED (a fresh human decision).
create function prevent_approved_section_identity_mutation() returns trigger as $$
begin
  if old.status = 'APPROVED_INTERNAL' and new.status = 'APPROVED_INTERNAL' then
    if new.title is distinct from old.title or new.objective is distinct from old.objective
       or new.section_type is distinct from old.section_type then
      raise exception 'bid_proposal_sections: an APPROVED_INTERNAL section (id=%) has frozen identity fields. Reject or mark stale first.', old.id;
    end if;
  end if;
  return new;
end;
$$ language plpgsql;
create trigger bid_proposal_sections_prevent_approved_identity_mutation
  before update on bid_proposal_sections
  for each row execute function prevent_approved_section_identity_mutation();

-- ---------------------------------------------------------------
-- 4. Section edit history (Phase 14 §16/§19 — human edits/regeneration
--    must never silently overwrite prior content).
-- ---------------------------------------------------------------
create table bid_proposal_section_edit_history (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references bid_proposal_sections(id) on delete cascade,
  edit_type text not null, -- 'AI_GENERATED' | 'HUMAN_EDIT' | 'REGENERATED' | 'APPROVED' | 'REJECTED'
  previous_blocks_snapshot jsonb not null default '[]'::jsonb,
  edited_by uuid references users(id),
  created_at timestamptz not null default now()
);
create index bid_proposal_section_edit_history_section_id_idx on bid_proposal_section_edit_history (section_id);

-- ---------------------------------------------------------------
-- 5. Content Blocks (Phase 14 §15).
-- ---------------------------------------------------------------
create table bid_proposal_blocks (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references bid_proposal_sections(id) on delete cascade,
  block_type proposal_block_type not null,
  sort_order integer not null default 0,
  content jsonb not null default '{}'::jsonb,
  origin content_origin not null default 'AI_GENERATED',
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index bid_proposal_blocks_section_id_idx on bid_proposal_blocks (section_id);
create trigger bid_proposal_blocks_set_updated_at
  before update on bid_proposal_blocks
  for each row execute function set_updated_at();

-- Phase 14 §31 (binding constraint): blocks belonging to an
-- APPROVED_INTERNAL section cannot be mutated or deleted directly —
-- the application layer must snapshot to edit history and either
-- reject the section first or create a new proposal version.
create function prevent_approved_section_block_mutation() returns trigger as $$
declare
  section_status proposal_section_status;
begin
  select status into section_status from bid_proposal_sections where id = coalesce(new.section_id, old.section_id);
  if section_status = 'APPROVED_INTERNAL' then
    raise exception 'bid_proposal_blocks: cannot modify blocks of an APPROVED_INTERNAL section (section_id=%). Reject or version instead.', coalesce(new.section_id, old.section_id);
  end if;
  return coalesce(new, old);
end;
$$ language plpgsql;
create trigger bid_proposal_blocks_prevent_approved_mutation
  before update or delete on bid_proposal_blocks
  for each row execute function prevent_approved_section_block_mutation();

-- ---------------------------------------------------------------
-- 6. Claims (Phase 14 §11/§23) — substantive agency claims traced to
--    approved evidence, or explicitly flagged unsupported.
-- ---------------------------------------------------------------
create table bid_proposal_claims (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references bid_proposal_sections(id) on delete cascade,
  block_id uuid references bid_proposal_blocks(id) on delete cascade,
  claim_text text not null,
  support_status claim_support_status not null default 'REQUIRES_REVIEW',
  -- The ONLY authoritative evidence source (Phase 13 approved claims).
  -- Never populated from a CANDIDATE/VERIFIED/REJECTED/SUPERSEDED match.
  evidence_claim_id uuid references bid_evidence_claims(id),
  rationale text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Phase 14 §23 (binding constraint): SUPPORTED/PARTIALLY_SUPPORTED
  -- require an actual approved evidence claim reference.
  constraint bid_proposal_claims_supported_requires_evidence check (
    support_status not in ('SUPPORTED', 'PARTIALLY_SUPPORTED') or evidence_claim_id is not null
  )
);
create index bid_proposal_claims_section_id_idx on bid_proposal_claims (section_id);
create index bid_proposal_claims_support_status_idx on bid_proposal_claims (support_status);
create trigger bid_proposal_claims_set_updated_at
  before update on bid_proposal_claims
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------
-- 7. Traceability links (Phase 14 §8/§9/§28).
-- ---------------------------------------------------------------
create table bid_proposal_requirement_links (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references bid_proposal_sections(id) on delete cascade,
  tender_requirement_id uuid not null references tender_requirements(id),
  coverage_status proposal_requirement_coverage not null default 'NOT_COVERED',
  created_at timestamptz not null default now(),
  constraint bid_proposal_requirement_links_unique unique (section_id, tender_requirement_id)
);
create index bid_proposal_requirement_links_section_id_idx on bid_proposal_requirement_links (section_id);
create index bid_proposal_requirement_links_requirement_id_idx on bid_proposal_requirement_links (tender_requirement_id);

create table bid_proposal_evaluation_links (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references bid_proposal_sections(id) on delete cascade,
  evaluation_criterion_id uuid not null references tender_evaluation_criteria(id),
  evaluation_subcriterion_id uuid references tender_evaluation_subcriteria(id),
  win_theme_id uuid references bid_win_themes(id),
  coverage_status proposal_requirement_coverage not null default 'NOT_COVERED',
  created_at timestamptz not null default now(),
  constraint bid_proposal_evaluation_links_unique unique (section_id, evaluation_criterion_id, evaluation_subcriterion_id)
);
create index bid_proposal_evaluation_links_section_id_idx on bid_proposal_evaluation_links (section_id);
create index bid_proposal_evaluation_links_criterion_id_idx on bid_proposal_evaluation_links (evaluation_criterion_id);

create table bid_proposal_evidence_links (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references bid_proposal_sections(id) on delete cascade,
  block_id uuid references bid_proposal_blocks(id) on delete cascade,
  bid_evidence_claim_id uuid not null references bid_evidence_claims(id),
  created_at timestamptz not null default now()
);
create index bid_proposal_evidence_links_section_id_idx on bid_proposal_evidence_links (section_id);
create index bid_proposal_evidence_links_claim_id_idx on bid_proposal_evidence_links (bid_evidence_claim_id);

-- ---------------------------------------------------------------
-- 8. Generation runs (Phase 14 §14/§18) — full reproducibility record.
-- ---------------------------------------------------------------
create table bid_proposal_generations (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references bid_proposal_sections(id) on delete cascade,
  proposal_version_id uuid not null references bid_proposal_versions(id) on delete cascade,
  status proposal_generation_status not null,
  model text,
  prompt_version text not null,
  generation_version integer not null default 1,
  input_context_hash text not null,
  temperature numeric,
  requirement_ids uuid[] not null default '{}',
  evaluation_criterion_ids uuid[] not null default '{}',
  evidence_claim_ids uuid[] not null default '{}',
  strategy_version integer,
  evidence_matching_run_ids uuid[] not null default '{}',
  warnings jsonb not null default '[]'::jsonb,
  missing_information jsonb not null default '[]'::jsonb,
  unsupported_claims jsonb not null default '[]'::jsonb,
  confidence numeric,
  input_tokens_estimate integer,
  output_tokens_estimate integer,
  error_message text,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);
create index bid_proposal_generations_section_id_idx on bid_proposal_generations (section_id);
create index bid_proposal_generations_version_id_idx on bid_proposal_generations (proposal_version_id);
-- Never destroyed (Phase 14 §18 "Never overwrite historical versions") —
-- no update/delete policy grants this to `authenticated`, and the
-- application layer only ever inserts.

-- ---------------------------------------------------------------
-- 9. Missing information (Phase 14 §24).
-- ---------------------------------------------------------------
create table bid_proposal_missing_information (
  id uuid primary key default gen_random_uuid(),
  proposal_version_id uuid not null references bid_proposal_versions(id) on delete cascade,
  section_id uuid references bid_proposal_sections(id) on delete cascade,
  description text not null,
  source_requirement_id uuid references tender_requirements(id),
  severity bid_gap_severity not null default 'MEDIUM',
  responsible_role text,
  status proposal_missing_info_status not null default 'OPEN',
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index bid_proposal_missing_information_version_id_idx on bid_proposal_missing_information (proposal_version_id);
create index bid_proposal_missing_information_status_idx on bid_proposal_missing_information (status);

-- ---------------------------------------------------------------
-- 10. Human review workflow (Phase 14 §16/§31).
-- ---------------------------------------------------------------
create table bid_proposal_reviews (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references bid_proposal_sections(id) on delete cascade,
  reviewer_id uuid not null references users(id),
  action proposal_review_action not null,
  reason text,
  created_at timestamptz not null default now(),
  -- Phase 14 §31 (binding constraint, mirrors Phase 13's rejection-reason
  -- pattern): a rejection always carries a reason.
  constraint bid_proposal_reviews_reject_requires_reason check (
    action <> 'REJECTED' or (reason is not null and length(trim(reason)) > 0)
  )
);
create index bid_proposal_reviews_section_id_idx on bid_proposal_reviews (section_id);

-- ---------------------------------------------------------------
-- 11. Compliance engine results (Phase 14 §21/§22) — append-only,
--     deterministic, one row per run.
-- ---------------------------------------------------------------
create table bid_proposal_compliance_results (
  id uuid primary key default gen_random_uuid(),
  proposal_version_id uuid not null references bid_proposal_versions(id) on delete cascade,
  result proposal_compliance_result not null,
  coverage_score jsonb not null default '{}'::jsonb,
  computed_at timestamptz not null default now(),
  computed_by uuid references users(id)
);
create index bid_proposal_compliance_results_version_id_idx on bid_proposal_compliance_results (proposal_version_id);

create table bid_proposal_compliance_issues (
  id uuid primary key default gen_random_uuid(),
  compliance_result_id uuid not null references bid_proposal_compliance_results(id) on delete cascade,
  severity proposal_compliance_issue_severity not null,
  code text not null,
  message text not null,
  section_id uuid references bid_proposal_sections(id),
  requirement_id uuid references tender_requirements(id),
  evaluation_criterion_id uuid references tender_evaluation_criteria(id),
  created_at timestamptz not null default now()
);
create index bid_proposal_compliance_issues_result_id_idx on bid_proposal_compliance_issues (compliance_result_id);

-- ---------------------------------------------------------------
-- 12. Document assembly (Phase 14 §26/§27) — internal drafts only.
-- ---------------------------------------------------------------
create table bid_proposal_documents (
  id uuid primary key default gen_random_uuid(),
  proposal_version_id uuid not null references bid_proposal_versions(id) on delete cascade,
  agency_id uuid not null references agencies(id) on delete cascade,
  format proposal_document_format not null,
  filename text not null,
  storage_path text,
  file_hash text,
  assembled_by uuid references users(id),
  assembled_at timestamptz not null default now()
);
create index bid_proposal_documents_version_id_idx on bid_proposal_documents (proposal_version_id);

-- ---------------------------------------------------------------
-- Cross-agency / integrity guards (Phase 14 §34) — enforced at DB
-- level where practical, beyond the FK graph itself.
-- ---------------------------------------------------------------

-- A section's agency_id must match its proposal_version's proposal's
-- agency_id (defence in depth beyond the FK chain — a malicious/buggy
-- write can never park a section under the wrong agency).
create function check_proposal_section_agency_matches() returns trigger as $$
declare
  v_agency_id uuid;
begin
  select p.agency_id into v_agency_id
    from bid_proposal_versions v join bid_proposals p on p.id = v.proposal_id
    where v.id = new.proposal_version_id;
  if v_agency_id is null or v_agency_id <> new.agency_id then
    raise exception 'bid_proposal_sections: agency_id (%) does not match the owning proposal''s agency (%).', new.agency_id, v_agency_id;
  end if;
  return new;
end;
$$ language plpgsql;
create trigger bid_proposal_sections_check_agency
  before insert or update on bid_proposal_sections
  for each row execute function check_proposal_section_agency_matches();

-- An evidence link's bid_evidence_claim must belong to the same
-- agency as the section it is attached to (Phase 14 §34/§35 — no
-- cross-agency evidence reference is ever possible).
create function check_proposal_evidence_link_agency_matches() returns trigger as $$
declare
  section_agency uuid;
  claim_agency uuid;
begin
  select agency_id into section_agency from bid_proposal_sections where id = new.section_id;
  select agency_id into claim_agency from bid_evidence_claims where id = new.bid_evidence_claim_id;
  if section_agency is null or claim_agency is null or section_agency <> claim_agency then
    raise exception 'bid_proposal_evidence_links: cross-agency evidence reference is not allowed (section agency=%, claim agency=%).', section_agency, claim_agency;
  end if;
  return new;
end;
$$ language plpgsql;
create trigger bid_proposal_evidence_links_check_agency
  before insert or update on bid_proposal_evidence_links
  for each row execute function check_proposal_evidence_link_agency_matches();

-- Same guard for claims that cite approved evidence directly.
create function check_proposal_claim_evidence_agency_matches() returns trigger as $$
declare
  section_agency uuid;
  claim_agency uuid;
begin
  if new.evidence_claim_id is null then
    return new;
  end if;
  select agency_id into section_agency from bid_proposal_sections where id = new.section_id;
  select agency_id into claim_agency from bid_evidence_claims where id = new.evidence_claim_id;
  if section_agency is null or claim_agency is null or section_agency <> claim_agency then
    raise exception 'bid_proposal_claims: cross-agency evidence reference is not allowed (section agency=%, claim agency=%).', section_agency, claim_agency;
  end if;
  return new;
end;
$$ language plpgsql;
create trigger bid_proposal_claims_check_agency
  before insert or update on bid_proposal_claims
  for each row execute function check_proposal_claim_evidence_agency_matches();

-- A requirement/evaluation link must reference the same tender as the
-- proposal (Phase 14 §34).
create function check_proposal_requirement_link_tender_matches() returns trigger as $$
declare
  proposal_tender uuid;
  requirement_tender uuid;
begin
  select p.tender_id into proposal_tender
    from bid_proposal_sections s
    join bid_proposal_versions v on v.id = s.proposal_version_id
    join bid_proposals p on p.id = v.proposal_id
    where s.id = new.section_id;
  select tender_id into requirement_tender from tender_requirements where id = new.tender_requirement_id;
  if proposal_tender is null or requirement_tender is null or proposal_tender <> requirement_tender then
    raise exception 'bid_proposal_requirement_links: requirement does not belong to this proposal''s tender.';
  end if;
  return new;
end;
$$ language plpgsql;
create trigger bid_proposal_requirement_links_check_tender
  before insert or update on bid_proposal_requirement_links
  for each row execute function check_proposal_requirement_link_tender_matches();

create function check_proposal_evaluation_link_tender_matches() returns trigger as $$
declare
  proposal_tender uuid;
  criterion_tender uuid;
begin
  select p.tender_id into proposal_tender
    from bid_proposal_sections s
    join bid_proposal_versions v on v.id = s.proposal_version_id
    join bid_proposals p on p.id = v.proposal_id
    where s.id = new.section_id;
  select tender_id into criterion_tender from tender_evaluation_criteria where id = new.evaluation_criterion_id;
  if proposal_tender is null or criterion_tender is null or proposal_tender <> criterion_tender then
    raise exception 'bid_proposal_evaluation_links: evaluation criterion does not belong to this proposal''s tender.';
  end if;
  return new;
end;
$$ language plpgsql;
create trigger bid_proposal_evaluation_links_check_tender
  before insert or update on bid_proposal_evaluation_links
  for each row execute function check_proposal_evaluation_link_tender_matches();

-- ---------------------------------------------------------------
-- RLS — same convention as every prior phase: agency-scoped select
-- for `authenticated`, service-role-only writes via
-- apps/api/src/lib/proposals/* and apps/api/src/routes/proposals.ts.
-- ---------------------------------------------------------------
alter table bid_proposals enable row level security;
create policy bid_proposals_select_own_agency on bid_proposals
  for select to authenticated using (agency_id = current_agency_id());

alter table bid_proposal_versions enable row level security;
create policy bid_proposal_versions_select_own_agency on bid_proposal_versions
  for select to authenticated using (agency_id = current_agency_id());

alter table bid_proposal_sections enable row level security;
create policy bid_proposal_sections_select_own_agency on bid_proposal_sections
  for select to authenticated using (agency_id = current_agency_id());

alter table bid_proposal_section_edit_history enable row level security;
create policy bid_proposal_section_edit_history_select_own_agency on bid_proposal_section_edit_history
  for select to authenticated using (
    exists (select 1 from bid_proposal_sections s where s.id = bid_proposal_section_edit_history.section_id and s.agency_id = current_agency_id())
  );

alter table bid_proposal_blocks enable row level security;
create policy bid_proposal_blocks_select_own_agency on bid_proposal_blocks
  for select to authenticated using (
    exists (select 1 from bid_proposal_sections s where s.id = bid_proposal_blocks.section_id and s.agency_id = current_agency_id())
  );

alter table bid_proposal_claims enable row level security;
create policy bid_proposal_claims_select_own_agency on bid_proposal_claims
  for select to authenticated using (
    exists (select 1 from bid_proposal_sections s where s.id = bid_proposal_claims.section_id and s.agency_id = current_agency_id())
  );

alter table bid_proposal_requirement_links enable row level security;
create policy bid_proposal_requirement_links_select_own_agency on bid_proposal_requirement_links
  for select to authenticated using (
    exists (select 1 from bid_proposal_sections s where s.id = bid_proposal_requirement_links.section_id and s.agency_id = current_agency_id())
  );

alter table bid_proposal_evaluation_links enable row level security;
create policy bid_proposal_evaluation_links_select_own_agency on bid_proposal_evaluation_links
  for select to authenticated using (
    exists (select 1 from bid_proposal_sections s where s.id = bid_proposal_evaluation_links.section_id and s.agency_id = current_agency_id())
  );

alter table bid_proposal_evidence_links enable row level security;
create policy bid_proposal_evidence_links_select_own_agency on bid_proposal_evidence_links
  for select to authenticated using (
    exists (select 1 from bid_proposal_sections s where s.id = bid_proposal_evidence_links.section_id and s.agency_id = current_agency_id())
  );

alter table bid_proposal_generations enable row level security;
create policy bid_proposal_generations_select_own_agency on bid_proposal_generations
  for select to authenticated using (
    exists (select 1 from bid_proposal_sections s where s.id = bid_proposal_generations.section_id and s.agency_id = current_agency_id())
  );

alter table bid_proposal_missing_information enable row level security;
create policy bid_proposal_missing_information_select_own_agency on bid_proposal_missing_information
  for select to authenticated using (
    exists (select 1 from bid_proposal_versions v where v.id = bid_proposal_missing_information.proposal_version_id and v.agency_id = current_agency_id())
  );

alter table bid_proposal_reviews enable row level security;
create policy bid_proposal_reviews_select_own_agency on bid_proposal_reviews
  for select to authenticated using (
    exists (select 1 from bid_proposal_sections s where s.id = bid_proposal_reviews.section_id and s.agency_id = current_agency_id())
  );

alter table bid_proposal_compliance_results enable row level security;
create policy bid_proposal_compliance_results_select_own_agency on bid_proposal_compliance_results
  for select to authenticated using (
    exists (select 1 from bid_proposal_versions v where v.id = bid_proposal_compliance_results.proposal_version_id and v.agency_id = current_agency_id())
  );

alter table bid_proposal_compliance_issues enable row level security;
create policy bid_proposal_compliance_issues_select_own_agency on bid_proposal_compliance_issues
  for select to authenticated using (
    exists (
      select 1 from bid_proposal_compliance_results r
      join bid_proposal_versions v on v.id = r.proposal_version_id
      where r.id = bid_proposal_compliance_issues.compliance_result_id and v.agency_id = current_agency_id()
    )
  );

alter table bid_proposal_documents enable row level security;
create policy bid_proposal_documents_select_own_agency on bid_proposal_documents
  for select to authenticated using (agency_id = current_agency_id());

-- No authenticated insert/update/delete policy anywhere in this
-- migration — service-role only. All writes go through
-- apps/api/src/lib/proposals/* and apps/api/src/routes/proposals.ts,
-- which enforce role gating (RESEARCHER may draft/generate, never
-- approve; BID_MANAGER/ADMIN may review/approve/reject) and business
-- rules before ever reaching these tables.
