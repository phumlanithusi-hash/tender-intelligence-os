-- Phase 8: Qualification & Compliance Intelligence.
--
-- Reviewed first (Phase 8 §7/§8, per the binding spec): `tender_requirements`
-- (Phase 2, 20260910200110) already models one requirement per tender with a
-- per-agency `qualification_status` gated by `agency_evidence` — this phase
-- EXTENDS it rather than duplicating it. Agency-side evidence tables
-- (agencies, agency_documents, agency_certificates, agency_case_studies,
-- agency_references, agency_clients, agency_team, agency_policies,
-- agency_evidence) ALSO already exist from Phase 2 — contrary to the "these
-- almost certainly do NOT exist yet" assumption in the spec, they do, and
-- are extended here with the minimum new columns/tables the rule engine
-- needs (numeric verified turnover, document lifecycle status, experience
-- matching dimensions) rather than rebuilt from scratch.
--
-- New in this migration:
--   1. Requirement model extensions: category/mandatory_status/source_truth/
--      requirement_status/rule_type/rule_config/versioning columns on
--      tender_requirements (Phase 8 §7).
--   2. Agency evidence extensions: agency_financial_records (verified
--      numeric turnover — agencies.turnover_band is a text band, not
--      usable for NUMERIC_MIN rules), lifecycle_status on
--      agency_documents/agency_certificates, matching dimensions on
--      agency_case_studies, a few missing status columns on agencies.
--   3. Qualification run/result/action/review/conflict tables — the
--      compliance-check record model (Phase 8 §30) and human review
--      (§36), agency-scoped RLS like tender_ai_runs (Phase 7).
--   4. Reuse of the Phase 7 AI run/claim/evidence infrastructure for the
--      QualificationInterpretationAgent (Phase 8 §26/§27) — a new
--      ai_claim_type value and a small structured-output child table,
--      NOT a parallel AI pipeline.

-- ---------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------
create type qualification_check_status as enum ('PASS', 'FAIL', 'UNKNOWN', 'REQUIRES_ACTION');
create type qualification_mandatory_status as enum ('MANDATORY', 'CONDITIONALLY_MANDATORY', 'PREFERENTIAL', 'INFORMATIONAL', 'UNKNOWN');
create type qualification_overall_status as enum ('ELIGIBLE', 'NOT_ELIGIBLE', 'REQUIRES_REVIEW', 'ACTION_REQUIRED', 'UNKNOWN');
create type qualification_category as enum (
  'CSD', 'TAX', 'B_BBEE', 'COMPANY_REGISTRATION', 'YEARS_IN_BUSINESS', 'TURNOVER',
  'RELEVANT_EXPERIENCE', 'REFERENCES', 'PROFESSIONAL_REGISTRATION', 'CERTIFICATION',
  'INSURANCE', 'KEY_PERSONNEL', 'CAPACITY', 'EQUIPMENT', 'GEOGRAPHIC',
  'COMPULSORY_BRIEFING', 'JV_SUBCONTRACTING', 'FINANCIAL', 'MANDATORY_FORM',
  'DECLARATION', 'SIGNATURE', 'SUBMISSION', 'OTHER', 'UNKNOWN'
);
create type qualification_rule_type as enum (
  'BOOLEAN', 'NUMERIC_MIN', 'NUMERIC_MAX', 'DATE', 'DATE_EXPIRY', 'ENUM',
  'TEXT', 'DOCUMENT', 'EXPERIENCE', 'REFERENCE', 'BRIEFING', 'COMPOSITE', 'MANUAL_REVIEW'
);
create type qualification_requirement_status as enum ('VERIFIED', 'PROVISIONAL', 'REQUIRES_REVIEW');
create type qualification_evaluated_by as enum ('DETERMINISTIC_RULE', 'AI_ASSISTED', 'MANUAL');
create type qualification_action_priority as enum ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');
create type qualification_action_status as enum ('OPEN', 'IN_PROGRESS', 'DONE', 'DISMISSED');
create type agency_document_lifecycle_status as enum ('VALID', 'EXPIRED', 'MISSING', 'PENDING_VERIFICATION', 'REJECTED', 'UNKNOWN');
create type qualification_run_status as enum ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');
create type qualification_conflict_status as enum ('OPEN', 'RESOLVED');

-- Reuse the Phase 7 AI claim vocabulary for the qualification agent's
-- output (Phase 8 §26 — "not a parallel reimplementation").
alter type ai_claim_type add value if not exists 'QUALIFICATION_INTERPRETATION';

-- ---------------------------------------------------------------
-- 1. tender_requirements extensions (Phase 8 §7). All nullable/defaulted
--    so existing Phase 2 rows and code keep working unchanged; the
--    legacy `requirement_type`/`mandatory`/`qualification_status`
--    columns are untouched.
-- ---------------------------------------------------------------
-- source_truth reuses the exact Phase 7 ai_truth_state enum (FACT /
-- INFERENCE / UNKNOWN / UNVERIFIED) rather than inventing a
-- near-duplicate vocabulary.
alter table tender_requirements
  add column category qualification_category not null default 'UNKNOWN',
  add column mandatory_status qualification_mandatory_status not null default 'UNKNOWN',
  add column source_truth ai_truth_state not null default 'UNKNOWN',
  add column requirement_status qualification_requirement_status not null default 'PROVISIONAL',
  add column rule_type qualification_rule_type,
  add column rule_config jsonb not null default '{}'::jsonb,
  add column version integer not null default 1,
  add column source_document_version_id uuid references tender_document_versions(id),
  add column superseded_by uuid references tender_requirements(id),
  add column superseded_at timestamptz,
  add column ai_run_id uuid references tender_ai_runs(id);

create index tender_requirements_category_idx on tender_requirements (category);
create index tender_requirements_mandatory_status_idx on tender_requirements (mandatory_status);
create index tender_requirements_requirement_status_idx on tender_requirements (requirement_status);
create index tender_requirements_superseded_by_idx on tender_requirements (superseded_by) where superseded_by is not null;

comment on column tender_requirements.requirement_status is
  'Phase 8 §6: PROVISIONAL requirements (AI-suggested candidates from Phase 7 apparentRequirements, not formally extracted) must never be presented as verified qualification rules.';

-- ---------------------------------------------------------------
-- 2. Agency evidence extensions (Phase 8 §8/§9/§11/§15).
-- ---------------------------------------------------------------

-- Verified numeric turnover — agencies.turnover_band (Phase 2) is a
-- text band ("R5m-R10m") and cannot back a NUMERIC_MIN rule; this adds
-- an actual verifiable figure without removing the band field.
create table agency_financial_records (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  period_label text not null,
  annual_turnover numeric,
  currency text not null default 'ZAR',
  evidence_status evidence_status not null default 'UNKNOWN',
  source_document_id uuid references agency_documents(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agency_financial_records_turnover_non_negative check (annual_turnover is null or annual_turnover >= 0)
);
create index agency_financial_records_agency_id_idx on agency_financial_records (agency_id);
create trigger agency_financial_records_set_updated_at
  before update on agency_financial_records
  for each row execute function set_updated_at();

alter table agency_documents add column lifecycle_status agency_document_lifecycle_status not null default 'UNKNOWN';
alter table agency_certificates add column lifecycle_status agency_document_lifecycle_status not null default 'UNKNOWN';

alter table agencies
  add column csd_status evidence_status not null default 'UNKNOWN',
  add column registration_status evidence_status not null default 'UNKNOWN',
  add column tax_expiry date,
  add column tax_evidence_document_id uuid references agency_documents(id);

-- Experience/reference matching dimensions (Phase 8 §15 — "defined
-- matching dimensions: service, industry, client type, project type,
-- value, geography, date"; geography stays free-text per the Phase 7
-- carried-forward FK-resolution limitation, Phase 8 §21/§42).
alter table agency_case_studies
  add column service_id uuid references services(id),
  add column client_type text,
  add column project_type text,
  add column geography_text text;

alter table agency_references
  add column reference_period_start date,
  add column reference_period_end date,
  add column project_similarity_notes text;

-- ---------------------------------------------------------------
-- 3. Qualification runs / results / actions / reviews / conflicts.
--    Agency-scoped like tender_ai_runs (Phase 7 §7) — qualification
--    is always relative to one agency's evidence.
-- ---------------------------------------------------------------
create table tender_qualification_runs (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references tenders(id) on delete cascade,
  agency_id uuid not null references agencies(id) on delete cascade,
  status qualification_run_status not null default 'QUEUED',
  overall_status qualification_overall_status,
  is_current boolean not null default true,
  mandatory_blocker_count integer not null default 0,
  action_required_count integer not null default 0,
  requires_review_count integer not null default 0,
  requirement_count integer not null default 0,
  error text,
  triggered_by uuid references users(id),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tender_qualification_runs_tender_id_idx on tender_qualification_runs (tender_id);
create index tender_qualification_runs_agency_id_idx on tender_qualification_runs (agency_id);
create unique index tender_qualification_runs_current_unique
  on tender_qualification_runs (tender_id, agency_id)
  where is_current;
create unique index tender_qualification_runs_one_active_per_tender_agency
  on tender_qualification_runs (tender_id, agency_id)
  where status in ('QUEUED', 'RUNNING');
create trigger tender_qualification_runs_set_updated_at
  before update on tender_qualification_runs
  for each row execute function set_updated_at();

-- Compliance check record (Phase 8 §30) — one row per evaluated
-- requirement per run. Explanations are template-generated strings
-- (deterministic rules) or the agent's own evidence-gated
-- interpretation text (AI_ASSISTED) — never a separate freeform call.
create table tender_qualification_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references tender_qualification_runs(id) on delete cascade,
  requirement_id uuid not null references tender_requirements(id) on delete cascade,
  tender_id uuid not null references tenders(id) on delete cascade,
  agency_id uuid not null references agencies(id) on delete cascade,
  status qualification_check_status not null default 'UNKNOWN',
  mandatory boolean not null default false,
  mandatory_status qualification_mandatory_status not null default 'UNKNOWN',
  explanation text not null,
  evaluated_by qualification_evaluated_by not null default 'DETERMINISTIC_RULE',
  confidence numeric,
  requires_human_review boolean not null default false,
  evaluated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint tender_qualification_results_confidence_range check (confidence is null or confidence between 0 and 1)
);
create index tender_qualification_results_run_id_idx on tender_qualification_results (run_id);
create index tender_qualification_results_requirement_id_idx on tender_qualification_results (requirement_id);
create index tender_qualification_results_tender_id_idx on tender_qualification_results (tender_id);
create index tender_qualification_results_agency_id_idx on tender_qualification_results (agency_id);
create index tender_qualification_results_status_idx on tender_qualification_results (status);

-- Evidence for a compliance check, split tender-side vs agency-side
-- (Phase 8 §30/§34). Tender evidence mirrors tender_ai_evidence's
-- shape/provenance exactly (chunk/section/page — page_id intentionally
-- carried forward as unpopulated, Phase 7/Phase 8 §42 technical debt).
-- Agency evidence points at the already-generic, polymorphic
-- agency_evidence table (Phase 2) rather than a new one.
create table tender_qualification_result_tender_evidence (
  id uuid primary key default gen_random_uuid(),
  result_id uuid not null references tender_qualification_results(id) on delete cascade,
  document_id uuid not null references tender_documents(id),
  document_version_id uuid references tender_document_versions(id),
  page_id uuid references tender_document_pages(id),
  section_id uuid references tender_document_sections(id),
  chunk_id uuid references tender_document_chunks(id),
  page_number integer,
  evidence_text text not null,
  created_at timestamptz not null default now()
);
create index tqr_tender_evidence_result_id_idx on tender_qualification_result_tender_evidence (result_id);

create table tender_qualification_result_agency_evidence (
  id uuid primary key default gen_random_uuid(),
  result_id uuid not null references tender_qualification_results(id) on delete cascade,
  agency_evidence_id uuid not null references agency_evidence(id),
  description text,
  created_at timestamptz not null default now()
);
create index tqr_agency_evidence_result_id_idx on tender_qualification_result_agency_evidence (result_id);

-- Actions (Phase 8 §32) — persisted as their own record type tied to
-- the compliance check / requirement, never invented due dates.
create table tender_qualification_actions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references tender_qualification_runs(id) on delete cascade,
  result_id uuid references tender_qualification_results(id) on delete cascade,
  requirement_id uuid not null references tender_requirements(id) on delete cascade,
  tender_id uuid not null references tenders(id) on delete cascade,
  agency_id uuid not null references agencies(id) on delete cascade,
  description text not null,
  priority qualification_action_priority not null default 'MEDIUM',
  due_date timestamptz,
  status qualification_action_status not null default 'OPEN',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tender_qualification_actions_run_id_idx on tender_qualification_actions (run_id);
create index tender_qualification_actions_tender_id_idx on tender_qualification_actions (tender_id);
create index tender_qualification_actions_agency_id_idx on tender_qualification_actions (agency_id);
create trigger tender_qualification_actions_set_updated_at
  before update on tender_qualification_actions
  for each row execute function set_updated_at();

-- Human review records (Phase 8 §36) — against a specific requirement
-- or the overall run when requirement_id is null.
create table tender_qualification_reviews (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references tender_qualification_runs(id) on delete cascade,
  requirement_id uuid references tender_requirements(id) on delete cascade,
  tender_id uuid not null references tenders(id) on delete cascade,
  agency_id uuid not null references agencies(id) on delete cascade,
  reviewer_id uuid not null references users(id),
  decision text not null,
  note text,
  created_at timestamptz not null default now()
);
create index tender_qualification_reviews_run_id_idx on tender_qualification_reviews (run_id);
create index tender_qualification_reviews_requirement_id_idx on tender_qualification_reviews (requirement_id);
create index tender_qualification_reviews_tender_id_idx on tender_qualification_reviews (tender_id);

-- Conflicting requirement values across documents (Phase 8 §28) — the
-- requirement becomes REQUIRES_REVIEW until a later addenda-resolution
-- mechanism (out of scope) resolves it; both evidence sides preserved,
-- never silently merged/chosen.
create table tender_requirement_conflicts (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references tenders(id) on delete cascade,
  category qualification_category not null default 'UNKNOWN',
  description text not null,
  evidence_a jsonb not null,
  evidence_b jsonb not null,
  requirement_id uuid references tender_requirements(id) on delete set null,
  status qualification_conflict_status not null default 'OPEN',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tender_requirement_conflicts_tender_id_idx on tender_requirement_conflicts (tender_id);
create trigger tender_requirement_conflicts_set_updated_at
  before update on tender_requirement_conflicts
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------
-- 4. QualificationInterpretationAgent structured output — reuses
--    tender_ai_runs (agent_name = 'QualificationInterpretationAgent')
--    and tender_ai_claims/tender_ai_evidence exactly as-is (Phase 8
--    §26/§27). This table holds only the extra structured fields the
--    classification agent's output shape doesn't have.
-- ---------------------------------------------------------------
create table tender_qualification_ai_interpretations (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references tender_ai_runs(id) on delete cascade,
  claim_id uuid references tender_ai_claims(id) on delete cascade,
  requirement_text text not null,
  category qualification_category not null default 'UNKNOWN',
  rule_type qualification_rule_type,
  mandatory_status qualification_mandatory_status not null default 'UNKNOWN',
  interpretation text not null default '',
  truth ai_truth_state not null default 'UNKNOWN',
  confidence numeric,
  created_at timestamptz not null default now(),
  constraint tender_qualification_ai_interpretations_confidence_range check (confidence is null or confidence between 0 and 1)
);
create index tqai_run_id_idx on tender_qualification_ai_interpretations (run_id);
create index tqai_claim_id_idx on tender_qualification_ai_interpretations (claim_id);

-- ---------------------------------------------------------------
-- RLS. All new tables are agency-relative and follow the SAME shape
-- as tender_ai_runs/classifications (Phase 7): select-only for
-- `authenticated`, scoped by agency_id (directly or via join to
-- run/result); all writes go through the privileged service-role
-- client (apps/api/src/lib/qualification + routes/tenderQualification.ts).
-- ---------------------------------------------------------------
alter table agency_financial_records enable row level security;
create policy agency_financial_records_select_own_agency on agency_financial_records
  for select to authenticated using (agency_id = current_agency_id());

do $$
declare
  t text;
begin
  foreach t in array array['tender_qualification_runs']
  loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy %I on %I for select to authenticated using (agency_id = current_agency_id())',
      t || '_select_own_agency', t
    );
  end loop;
end $$;

alter table tender_qualification_results enable row level security;
create policy tender_qualification_results_select_own_agency on tender_qualification_results
  for select to authenticated using (agency_id = current_agency_id());

alter table tender_qualification_result_tender_evidence enable row level security;
create policy tqr_tender_evidence_select_own_agency on tender_qualification_result_tender_evidence
  for select to authenticated
  using (exists (
    select 1 from tender_qualification_results r
    where r.id = tender_qualification_result_tender_evidence.result_id and r.agency_id = current_agency_id()
  ));

alter table tender_qualification_result_agency_evidence enable row level security;
create policy tqr_agency_evidence_select_own_agency on tender_qualification_result_agency_evidence
  for select to authenticated
  using (exists (
    select 1 from tender_qualification_results r
    where r.id = tender_qualification_result_agency_evidence.result_id and r.agency_id = current_agency_id()
  ));

alter table tender_qualification_actions enable row level security;
create policy tender_qualification_actions_select_own_agency on tender_qualification_actions
  for select to authenticated using (agency_id = current_agency_id());

alter table tender_qualification_reviews enable row level security;
create policy tender_qualification_reviews_select_own_agency on tender_qualification_reviews
  for select to authenticated using (agency_id = current_agency_id());

-- Requirement conflicts have no agency_id — they describe the tender
-- document set itself, not any one agency's evidence — so they follow
-- the shared-catalogue read shape (same as tender_requirements itself).
alter table tender_requirement_conflicts enable row level security;
create policy tender_requirement_conflicts_select_authenticated on tender_requirement_conflicts
  for select to authenticated using (true);

alter table tender_qualification_ai_interpretations enable row level security;
create policy tqai_select_own_agency on tender_qualification_ai_interpretations
  for select to authenticated
  using (exists (
    select 1 from tender_ai_runs r
    where r.id = tender_qualification_ai_interpretations.run_id and r.agency_id = current_agency_id()
  ));

-- No authenticated insert/update/delete policy on any table above —
-- service-role only, same convention as Phase 6/Phase 7.
