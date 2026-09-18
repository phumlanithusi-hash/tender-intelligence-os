-- Phase 9: Requirement & Evaluation Extraction.
--
-- Reviewed first, per the binding spec (Phase 9 §5/§16): `tender_requirements`
-- (Phase 2, extended by Phase 8) and `tender_evaluation_criteria`/
-- `tender_evaluation_subcriteria` (Phase 2) ALREADY EXIST. This phase extends
-- them rather than duplicating a parallel requirement/criterion model.
--
-- Taxonomy reuse: the Phase 9 taxonomy (ELIGIBILITY, QUALIFICATION,
-- TECHNICAL, FUNCTIONALITY, SUBMISSION, ADMINISTRATIVE, COMMERCIAL, PRICE,
-- PREFERENCE, LOCAL_CONTENT, CONTRACTUAL, INFORMATIONAL) is NOT the same
-- axis as Phase 8's `category` column (qualification_category: CSD, TAX,
-- B_BBEE, ... — an agency-evidence check category). It IS the same axis as
-- the original Phase 2 `requirement_type` enum/column, which already has
-- ELIGIBILITY/ADMINISTRATIVE/TECHNICAL/SUBMISSION — so this migration simply
-- ADDS the missing taxonomy values to that existing enum/column rather than
-- introducing a second category column (Phase 9 §5).
--
-- Extraction agent: RequirementExtractionAgent is a third agent alongside
-- TenderClassificationAgent (Phase 7) and QualificationInterpretationAgent
-- (Phase 8), reusing tender_ai_runs/tender_ai_claims/tender_ai_evidence
-- exactly (Phase 9 §30) rather than a fourth parallel run-tracking table.
-- Because requirement/evaluation extraction is a property of the tender's
-- OWN document set — not relative to any one agency's services, unlike
-- Phase 7 classification or Phase 8 qualification — tender_ai_runs.agency_id
-- is relaxed to nullable here, with an additional shared-read RLS policy and
-- its own idempotency index for agency_id IS NULL rows. Existing
-- agency-scoped rows (classification/qualification) are completely
-- unaffected (Phase 9 §51/DECISIONS.md documents this adaptation).

-- ---------------------------------------------------------------
-- 0. Enum extensions (additive only).
-- ---------------------------------------------------------------
alter type requirement_type add value if not exists 'QUALIFICATION';
alter type requirement_type add value if not exists 'FUNCTIONALITY';
alter type requirement_type add value if not exists 'COMMERCIAL';
alter type requirement_type add value if not exists 'PRICE';
alter type requirement_type add value if not exists 'PREFERENCE';
alter type requirement_type add value if not exists 'LOCAL_CONTENT';
alter type requirement_type add value if not exists 'CONTRACTUAL';
alter type requirement_type add value if not exists 'INFORMATIONAL';

alter type qualification_requirement_status add value if not exists 'CONFLICT';

alter type ai_claim_type add value if not exists 'REQUIREMENT_EXTRACTION';
alter type ai_claim_type add value if not exists 'EVALUATION_CRITERION_EXTRACTION';
alter type ai_claim_type add value if not exists 'EVALUATION_GATE_EXTRACTION';

create type evaluation_criterion_type as enum (
  'FUNCTIONALITY', 'PRICE', 'PREFERENCE', 'LOCAL_CONTENT', 'TECHNICAL', 'PRESENTATION', 'INTERVIEW', 'OTHER', 'UNKNOWN'
);

-- ---------------------------------------------------------------
-- 1. tender_requirements extensions (Phase 9 §5/§6/§9/§12).
-- ---------------------------------------------------------------
alter table tender_requirements
  add column parent_requirement_id uuid references tender_requirements(id),
  add column disqualification_risk boolean not null default false,
  add column ai_claim_id uuid references tender_ai_claims(id);

create index tender_requirements_parent_idx on tender_requirements (parent_requirement_id) where parent_requirement_id is not null;
create index tender_requirements_disqualification_risk_idx on tender_requirements (disqualification_risk) where disqualification_risk;

comment on column tender_requirements.requirement_type is
  'Phase 9 §4/§5: doubles as the Phase 9 requirement taxonomy (ELIGIBILITY/QUALIFICATION/TECHNICAL/FUNCTIONALITY/SUBMISSION/ADMINISTRATIVE/COMMERCIAL/PRICE/PREFERENCE/LOCAL_CONTENT/CONTRACTUAL/INFORMATIONAL/...). Extended, not duplicated.';
comment on column tender_requirements.disqualification_risk is
  'Phase 9 §12: flags disqualification/elimination/non-responsive language. Severity flag only — never sets qualification_status (that remains Phase 8''s job against real agency evidence).';

-- Multi-evidence per requirement (Phase 9 §9/§36) — a requirement may be
-- grounded in more than one chunk/section. Mirrors
-- tender_qualification_result_tender_evidence's shape exactly.
create table tender_requirement_evidence (
  id uuid primary key default gen_random_uuid(),
  requirement_id uuid not null references tender_requirements(id) on delete cascade,
  document_id uuid not null references tender_documents(id),
  document_version_id uuid references tender_document_versions(id),
  page_id uuid references tender_document_pages(id),
  section_id uuid references tender_document_sections(id),
  chunk_id uuid references tender_document_chunks(id),
  page_number integer,
  evidence_text text not null,
  created_at timestamptz not null default now()
);
create index tender_requirement_evidence_requirement_id_idx on tender_requirement_evidence (requirement_id);
create index tender_requirement_evidence_document_id_idx on tender_requirement_evidence (document_id);

-- Human review trail (Phase 9 §41), append-only — never overwrites the
-- original AI extraction; mirrors tender_qualification_reviews's shape.
create table tender_requirement_reviews (
  id uuid primary key default gen_random_uuid(),
  requirement_id uuid not null references tender_requirements(id) on delete cascade,
  tender_id uuid not null references tenders(id) on delete cascade,
  reviewer_id uuid not null references users(id),
  decision text not null,
  note text,
  created_at timestamptz not null default now()
);
create index tender_requirement_reviews_requirement_id_idx on tender_requirement_reviews (requirement_id);
create index tender_requirement_reviews_tender_id_idx on tender_requirement_reviews (tender_id);

-- tender_requirement_conflicts already exists (Phase 8, 20260911160000) and
-- is reused as-is for Phase 9 requirement conflicts (Phase 9 §28) — no
-- changes needed; it already has evidence_a/evidence_b jsonb + status.

-- ---------------------------------------------------------------
-- 2. tender_evaluation_criteria extensions (Phase 9 §16-§27).
--    NEVER INVENT WEIGHTS (Phase 9 §18): maximum_points/weight/
--    minimum_score/scoring_bands/formula_* all remain nullable with no
--    default other than null/'UNKNOWN' — nothing here computes or
--    assumes a value the source document didn't state.
-- ---------------------------------------------------------------
alter table tender_evaluation_criteria
  add column parent_criterion_id uuid references tender_evaluation_criteria(id),
  add column criterion_type evaluation_criterion_type not null default 'UNKNOWN',
  add column maximum_points numeric,
  -- Explicit scoring bands as stated in the document, e.g.
  -- [{ "minPercent": 80, "maxPercent": 100, "points": 20, "rawText": "..." }].
  -- Never computed; empty array means none were stated (Phase 9 §20/§48).
  add column scoring_bands jsonb not null default '[]'::jsonb,
  -- Gating (Phase 9 §21/§22): represented on the criterion itself rather
  -- than only in a side table, so "this IS the functionality gate" is
  -- visible directly on the criterion row.
  add column gate boolean not null default false,
  add column threshold_type text,
  -- Price/other explicit formulas (Phase 9 §23/§27) — captured as source
  -- text + best-effort structured metadata; NEVER executed here or later
  -- in this phase (execution is explicitly out of scope, Phase 9 §27/§53).
  add column formula_text text,
  add column formula_type text,
  add column formula_variables jsonb not null default '{}'::jsonb,
  -- Local content (Phase 9 §25).
  add column local_content_min_percent numeric,
  -- Presentation/interview (Phase 9 §26).
  add column presentation_mandatory boolean,
  add column presentation_date timestamptz,
  add column presentation_attendees text,
  -- Truth/status/versioning, matching tender_requirements' Phase 8 shape
  -- exactly (Phase 9 §17/§29).
  add column source_truth ai_truth_state not null default 'UNKNOWN',
  add column status qualification_requirement_status not null default 'PROVISIONAL',
  add column version integer not null default 1,
  add column source_document_version_id uuid references tender_document_versions(id),
  add column superseded_by uuid references tender_evaluation_criteria(id),
  add column superseded_at timestamptz,
  add column ai_run_id uuid references tender_ai_runs(id),
  add column ai_claim_id uuid references tender_ai_claims(id);

create index tender_evaluation_criteria_parent_idx on tender_evaluation_criteria (parent_criterion_id) where parent_criterion_id is not null;
create index tender_evaluation_criteria_criterion_type_idx on tender_evaluation_criteria (criterion_type);
create index tender_evaluation_criteria_gate_idx on tender_evaluation_criteria (gate) where gate;
create index tender_evaluation_criteria_status_idx on tender_evaluation_criteria (status);
create index tender_evaluation_criteria_superseded_by_idx on tender_evaluation_criteria (superseded_by) where superseded_by is not null;

alter table tender_evaluation_criteria
  add constraint tender_evaluation_criteria_maximum_points_non_negative check (maximum_points is null or maximum_points >= 0),
  add constraint tender_evaluation_criteria_local_content_pct_range check (local_content_min_percent is null or (local_content_min_percent >= 0 and local_content_min_percent <= 100));

comment on column tender_evaluation_criteria.maximum_points is
  'Phase 9 §18/§19: exact points as stated in the source document, or null if unspecified. Never estimated; points and weight are conceptually distinct and both nullable independently.';

-- Multi-evidence per criterion, mirroring tender_requirement_evidence.
create table tender_evaluation_criterion_evidence (
  id uuid primary key default gen_random_uuid(),
  criterion_id uuid not null references tender_evaluation_criteria(id) on delete cascade,
  document_id uuid not null references tender_documents(id),
  document_version_id uuid references tender_document_versions(id),
  page_id uuid references tender_document_pages(id),
  section_id uuid references tender_document_sections(id),
  chunk_id uuid references tender_document_chunks(id),
  page_number integer,
  evidence_text text not null,
  created_at timestamptz not null default now()
);
create index tender_evaluation_criterion_evidence_criterion_id_idx on tender_evaluation_criterion_evidence (criterion_id);

-- Dedicated gates table (Phase 9 §22) for gates that are not simply "this
-- one criterion, gated" — e.g. a general "must average 70% across all
-- functionality criteria to proceed to price" statement that names no
-- single criterion. criterion_id is nullable for exactly that case.
create table tender_evaluation_gates (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references tenders(id) on delete cascade,
  criterion_id uuid references tender_evaluation_criteria(id) on delete cascade,
  name text not null,
  threshold numeric,
  threshold_type text,
  description text,
  source_truth ai_truth_state not null default 'UNKNOWN',
  status qualification_requirement_status not null default 'PROVISIONAL',
  version integer not null default 1,
  superseded_by uuid references tender_evaluation_gates(id),
  superseded_at timestamptz,
  ai_run_id uuid references tender_ai_runs(id),
  ai_claim_id uuid references tender_ai_claims(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tender_evaluation_gates_tender_id_idx on tender_evaluation_gates (tender_id);
create index tender_evaluation_gates_criterion_id_idx on tender_evaluation_gates (criterion_id) where criterion_id is not null;
create trigger tender_evaluation_gates_set_updated_at
  before update on tender_evaluation_gates
  for each row execute function set_updated_at();

create table tender_evaluation_gate_evidence (
  id uuid primary key default gen_random_uuid(),
  gate_id uuid not null references tender_evaluation_gates(id) on delete cascade,
  document_id uuid not null references tender_documents(id),
  document_version_id uuid references tender_document_versions(id),
  page_id uuid references tender_document_pages(id),
  section_id uuid references tender_document_sections(id),
  chunk_id uuid references tender_document_chunks(id),
  page_number integer,
  evidence_text text not null,
  created_at timestamptz not null default now()
);
create index tender_evaluation_gate_evidence_gate_id_idx on tender_evaluation_gate_evidence (gate_id);

-- Evaluation conflicts (Phase 9 §28) — mirrors tender_requirement_conflicts
-- exactly, for the evaluation side (e.g. addendum changes Functionality
-- from 70 to 80 points). Never auto-resolved; both sides preserved.
create table tender_evaluation_conflicts (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references tenders(id) on delete cascade,
  criterion_id uuid references tender_evaluation_criteria(id) on delete set null,
  description text not null,
  evidence_a jsonb not null,
  evidence_b jsonb not null,
  status qualification_conflict_status not null default 'OPEN',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tender_evaluation_conflicts_tender_id_idx on tender_evaluation_conflicts (tender_id);
create trigger tender_evaluation_conflicts_set_updated_at
  before update on tender_evaluation_conflicts
  for each row execute function set_updated_at();

-- Human review trail for evaluation criteria/gates (Phase 9 §41).
create table tender_evaluation_criteria_reviews (
  id uuid primary key default gen_random_uuid(),
  criterion_id uuid references tender_evaluation_criteria(id) on delete cascade,
  gate_id uuid references tender_evaluation_gates(id) on delete cascade,
  tender_id uuid not null references tenders(id) on delete cascade,
  reviewer_id uuid not null references users(id),
  decision text not null,
  note text,
  created_at timestamptz not null default now(),
  constraint tender_evaluation_criteria_reviews_target_check check (criterion_id is not null or gate_id is not null)
);
create index tender_evaluation_criteria_reviews_criterion_id_idx on tender_evaluation_criteria_reviews (criterion_id);
create index tender_evaluation_criteria_reviews_tender_id_idx on tender_evaluation_criteria_reviews (tender_id);

-- ---------------------------------------------------------------
-- 3. tender_ai_runs: relax agency_id to nullable for tender-scoped (not
--    agency-scoped) extraction runs (Phase 9 §30/§37, see header note).
--    Existing agency-scoped rows/behaviour are completely unaffected.
-- ---------------------------------------------------------------
alter table tender_ai_runs alter column agency_id drop not null;

-- Own idempotency guard for agency_id IS NULL rows — the pre-existing
-- unique index on (tender_id, agency_id) does not constrain multiple NULL
-- agency_id rows (NULLs are distinct from each other by default).
create unique index tender_ai_runs_one_active_per_tender_no_agency
  on tender_ai_runs (tender_id)
  where agency_id is null and status in ('QUEUED', 'RUNNING');

-- Diagnostic extraction-quality counters (Phase 9 §49) — generic enough to
-- be populated by any agent's run, nullable/zero-defaulted so Phase 7/8
-- runs are unaffected. Diagnostic only, never an "accuracy percentage".
alter table tender_ai_runs
  add column evidence_coverage numeric,
  add column conflict_count integer not null default 0,
  add column unknown_count integer not null default 0,
  add column requires_review_count integer not null default 0;

alter table tender_ai_runs
  add constraint tender_ai_runs_evidence_coverage_range check (evidence_coverage is null or evidence_coverage between 0 and 1);

-- Shared (not agency-scoped) read access for agency_id IS NULL runs and
-- their claims/evidence — additional PERMISSIVE policies OR together with
-- the existing agency-scoped ones (Postgres RLS semantics), so Phase 7/8
-- access is completely unchanged.
create policy tender_ai_runs_select_shared on tender_ai_runs
  for select to authenticated using (agency_id is null);

create policy tender_ai_claims_select_shared on tender_ai_claims
  for select to authenticated
  using (exists (
    select 1 from tender_ai_runs r
    where r.id = tender_ai_claims.run_id and r.agency_id is null
  ));

create policy tender_ai_evidence_select_shared on tender_ai_evidence
  for select to authenticated
  using (exists (
    select 1 from tender_ai_claims cl
    join tender_ai_runs r on r.id = cl.run_id
    where cl.id = tender_ai_evidence.claim_id and r.agency_id is null
  ));

-- ---------------------------------------------------------------
-- 4. RLS for new tables — all shared-catalogue shape (select true for
--    authenticated, no write policy), same as tender_requirements/
--    tender_evaluation_criteria themselves (Phase 2 §25) and
--    tender_requirement_conflicts (Phase 8) — this data describes the
--    tender's own document set, not any one agency's evidence.
-- ---------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'tender_requirement_evidence', 'tender_requirement_reviews',
    'tender_evaluation_criterion_evidence', 'tender_evaluation_gates',
    'tender_evaluation_gate_evidence', 'tender_evaluation_conflicts',
    'tender_evaluation_criteria_reviews'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy %I on %I for select to authenticated using (true)',
      t || '_select_authenticated', t
    );
  end loop;
end $$;

-- No authenticated insert/update/delete policy on any new table —
-- service-role only (same convention as every prior phase); writes go
-- through apps/api/src/lib/ai/execution/runRequirementEvaluationExtraction.ts
-- and routes/tenderRequirementsEvaluation.ts using the privileged client.
