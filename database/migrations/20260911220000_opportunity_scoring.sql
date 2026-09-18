-- Phase 10: Evaluation & Opportunity Scoring Engine.
--
-- NAMING NOTE (binding constraint, see docs/DECISIONS.md): this phase's
-- weights/config are called "opportunity scoring" throughout, and are
-- COMPLETELY SEPARATE from two pre-existing, unrelated things that must
-- never be confused with it:
--   1. shared/constants/src/scoring.ts (SCORING_WEIGHTS/SCORE_CLASSIFICATION_BANDS)
--      — an unused Phase-0 placeholder from the original spec draft, never
--      wired to any table or route. Left untouched.
--   2. tender_scores_risks (20260910200140) / the existing "score"/"risk"
--      tabs in TenderDetail.tsx — a pre-existing Phase 3 feature with its
--      own BID/NO_BID/PRIORITY_BID vocabulary, backed by its own table.
--      Left completely untouched; Phase 10 introduces its own new tables,
--      its own vocabulary (DECISION SIGNAL, never "bid"), and its own UI
--      tab ("Opportunity Score", distinct from the existing "Score" tab).
--
-- Reviewed first, per the binding spec: tender_requirements/
-- tender_evaluation_criteria (Phase 2/8/9), tender_qualification_runs/
-- results (Phase 8), agency evidence tables (Phase 2/8), agency_services/
-- tender_services (Phase 2), tender_geographic_scope (Phase 2) ALL
-- already exist and are consumed read-only by this phase's engine. This
-- migration adds only: (a) a handful of new agency-side columns/tables the
-- spec explicitly calls for and that do not already exist (agency
-- strategic profile fields, agency geographic capability, an explicit
-- criterion<->evidence link table), and (b) the scoring configuration +
-- run + component + driver + risk + gate tables themselves.

-- ---------------------------------------------------------------
-- 0. Enums.
-- ---------------------------------------------------------------
create type opportunity_score_dimension as enum (
  'QUALIFICATION', 'REQUIREMENT_COVERAGE', 'EVALUATION_FIT', 'EVIDENCE_STRENGTH', 'COMMERCIAL_FIT', 'STRATEGIC_FIT'
);
create type opportunity_component_status as enum ('KNOWN', 'UNKNOWN', 'NOT_APPLICABLE');
-- Never "BID"/"NO_BID" (Phase 10 §25) — this is a decision SIGNAL, not a decision.
create type opportunity_decision_signal as enum (
  'HIGH_PRIORITY', 'PROMISING', 'REVIEW', 'LOW_PRIORITY', 'BLOCKED', 'INSUFFICIENT_DATA'
);
create type opportunity_gate_type as enum (
  'MANDATORY_QUALIFICATION_FAILURE', 'MANDATORY_REQUIREMENT_FAILURE', 'COMPULSORY_BRIEFING_FAILURE',
  'SUBMISSION_DEADLINE_PASSED', 'CRITICAL_COMPLIANCE_FAILURE'
);
create type opportunity_gate_status as enum ('TRIGGERED', 'OK', 'UNKNOWN');
create type opportunity_scoring_run_status as enum ('QUEUED', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED');
create type opportunity_deadline_status as enum ('OPEN', 'CLOSED', 'UNKNOWN');

-- ---------------------------------------------------------------
-- 1. Agency-side additions the spec explicitly calls for and that do not
--    already exist: strategic-fit inputs (§18), commercial capacity
--    inputs (§17), and geographic capability (§20 — kept textual/FK-lite,
--    same carried-forward limitation as tender geography, Phase 7/8 §21/§42
--    NOT fixed here).
-- ---------------------------------------------------------------
alter table agencies
  add column min_project_value numeric,
  add column target_sectors text[] not null default '{}'::text[],
  add column preferred_org_types text[] not null default '{}'::text[],
  add column strategic_capabilities text[] not null default '{}'::text[],
  add column strategic_profile_status evidence_status not null default 'UNKNOWN',
  add constraint agencies_min_project_value_non_negative check (min_project_value is null or min_project_value >= 0);

comment on column agencies.strategic_profile_status is
  'Phase 10 §18: explicit UNKNOWN/UNVERIFIED marker so an empty target_sectors/preferred_org_types array is distinguishable from "agency has no sector preference" — the scoring engine treats strategic fit as UNKNOWN unless this is VERIFIED.';

-- Agency geographic capability, mirroring tender_geographic_scope's shape
-- exactly (Phase 10 §20 — explicitly NOT a new FK-resolution architecture,
-- just the agency-side mirror of the existing tender-side table).
create table agency_geographic_scope (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  scope_type geographic_scope_type not null,
  province_id uuid references provinces(id),
  municipality_id uuid references municipalities(id),
  custom_area_description text,
  created_at timestamptz not null default now(),
  constraint agency_geographic_scope_fields_match_type check (
    (scope_type = 'NATIONAL' and province_id is null and municipality_id is null and custom_area_description is null)
    or (scope_type = 'PROVINCE' and province_id is not null and municipality_id is null)
    or (scope_type in ('DISTRICT', 'METRO', 'LOCAL_MUNICIPALITY') and municipality_id is not null)
    or (scope_type = 'CUSTOM_AREA' and custom_area_description is not null)
  )
);
create index agency_geographic_scope_agency_id_idx on agency_geographic_scope (agency_id);

alter table agency_geographic_scope enable row level security;
create policy agency_geographic_scope_select_own_agency on agency_geographic_scope
  for select to authenticated using (agency_id = current_agency_id());

-- ---------------------------------------------------------------
-- 2. Explicit evaluation-criterion <-> agency-evidence link (Phase 10
--    §11/§12): the ONLY mechanism Evaluation Fit may use to say a
--    criterion is evidence-backed. Deliberately NOT auto-populated by any
--    semantic/text matching in this phase — rows here are created only by
--    an explicit human/reviewer action (or a test fixture), never by
--    an inference step. Absence of a row means UNKNOWN, full stop.
-- ---------------------------------------------------------------
create table tender_evaluation_criterion_agency_evidence (
  id uuid primary key default gen_random_uuid(),
  criterion_id uuid not null references tender_evaluation_criteria(id) on delete cascade,
  agency_id uuid not null references agencies(id) on delete cascade,
  -- Which agency evidence table the linked row lives in — kept as a
  -- discriminator + uuid rather than one FK per possible table, matching
  -- the existing generic `agency_evidence` polymorphic pattern (Phase 2).
  evidence_type text not null check (evidence_type in ('AGENCY_CASE_STUDY', 'AGENCY_CERTIFICATE', 'AGENCY_REFERENCE', 'AGENCY_DOCUMENT', 'AGENCY_TEAM', 'AGENCY_FINANCIAL_RECORD')),
  evidence_id uuid not null,
  linked_by uuid references users(id),
  note text,
  created_at timestamptz not null default now(),
  constraint tender_evaluation_criterion_agency_evidence_unique unique (criterion_id, agency_id, evidence_type, evidence_id)
);
create index tecae_criterion_id_idx on tender_evaluation_criterion_agency_evidence (criterion_id);
create index tecae_agency_id_idx on tender_evaluation_criterion_agency_evidence (agency_id);

alter table tender_evaluation_criterion_agency_evidence enable row level security;
create policy tecae_select_own_agency on tender_evaluation_criterion_agency_evidence
  for select to authenticated using (agency_id = current_agency_id());

-- ---------------------------------------------------------------
-- 3. Scoring configuration — versioned, never mutated in place (Phase 10
--    §5/§33). One "configuration" (named policy) can have many versions;
--    exactly one version per configuration is `is_current` at a time.
-- ---------------------------------------------------------------
create table scoring_configurations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger scoring_configurations_set_updated_at
  before update on scoring_configurations
  for each row execute function set_updated_at();

-- All the "single config source" values from Phase 10 §5/§6/§8/§15/§22/§24
-- live here as data, not scattered hard-coded constants in business logic.
create table scoring_configuration_versions (
  id uuid primary key default gen_random_uuid(),
  configuration_id uuid not null references scoring_configurations(id) on delete cascade,
  version integer not null,
  -- { QUALIFICATION: 0.2, REQUIREMENT_COVERAGE: 0.2, EVALUATION_FIT: 0.2, EVIDENCE_STRENGTH: 0.15, COMMERCIAL_FIT: 0.15, STRATEGIC_FIT: 0.1 } — must sum to 1 (enforced in application code, not SQL, so a config can be validated with a clear error before it is ever written).
  dimension_weights jsonb not null,
  -- { ELIGIBLE: 100, ACTION_REQUIRED: 60, REQUIRES_REVIEW: 40, UNKNOWN: 20, NOT_ELIGIBLE: 0 }
  qualification_status_score_map jsonb not null,
  -- { SUPPORTED: 1, PARTIALLY_SUPPORTED: 0.5, UNKNOWN: 0, ACTION_REQUIRED: 0, FAILED: 0, NOT_APPLICABLE: null }
  requirement_coverage_value_map jsonb not null,
  -- { STRONG: 1, MODERATE: 0.6, WEAK: 0.3 } — UNKNOWN criteria are excluded from the weighted average entirely, never assigned 0.
  evaluation_fit_value_map jsonb not null,
  -- { VERIFIED: 1, UNVERIFIED: 0.5, UNKNOWN: 0, MISSING: 0, EXPIRED: 0 }
  evidence_state_value_map jsonb not null,
  -- [{ min: 80, max: 100, signal: 'HIGH_PRIORITY' }, ...] — non-gated band lookup only; gates always take precedence (see runScoring/decisionSignal.ts).
  decision_bands jsonb not null,
  -- Below this fraction of total weight actually backed by a known score, decision signal becomes INSUFFICIENT_DATA regardless of the numeric score (Phase 10 §10/§22/§24).
  data_completeness_insufficient_threshold numeric not null,
  -- Dimensions whose own UNKNOWN status, by itself, forces INSUFFICIENT_DATA even if overall completeness is above the threshold (Phase 10 §24 "or a critical dimension itself UNKNOWN").
  critical_dimensions jsonb not null default '[]'::jsonb,
  is_current boolean not null default true,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  constraint scoring_configuration_versions_unique unique (configuration_id, version),
  constraint scoring_configuration_versions_threshold_range check (data_completeness_insufficient_threshold between 0 and 1)
);
create index scoring_configuration_versions_configuration_id_idx on scoring_configuration_versions (configuration_id);
create unique index scoring_configuration_versions_current_unique
  on scoring_configuration_versions (configuration_id)
  where is_current;

-- ---------------------------------------------------------------
-- 4. Scoring runs — append-only (Phase 10 §32/§33/§47), one current run
--    per tender+agency, agency-scoped exactly like tender_qualification_runs.
-- ---------------------------------------------------------------
create table tender_scoring_runs (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references tenders(id) on delete cascade,
  agency_id uuid not null references agencies(id) on delete cascade,
  status opportunity_scoring_run_status not null default 'QUEUED',
  scoring_configuration_version_id uuid not null references scoring_configuration_versions(id),
  overall_score numeric,
  data_completeness numeric,
  decision_signal opportunity_decision_signal,
  deadline_status opportunity_deadline_status not null default 'UNKNOWN',
  timezone_unknown boolean not null default true,
  is_current boolean not null default true,
  -- Snapshot of the IDs/versions of everything this run consumed (Phase 10
  -- §34/§46), e.g. { qualificationRunId, qualificationRunUpdatedAt,
  -- requirementVersions: {...}, evaluationCriteriaVersions: {...},
  -- agencyUpdatedAt, evidenceLinkCount }. References, not copies.
  input_snapshot jsonb not null default '{}'::jsonb,
  error text,
  triggered_by uuid references users(id),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tender_scoring_runs_overall_score_range check (overall_score is null or overall_score between 0 and 100),
  constraint tender_scoring_runs_completeness_range check (data_completeness is null or data_completeness between 0 and 1)
);
create index tender_scoring_runs_tender_id_idx on tender_scoring_runs (tender_id);
create index tender_scoring_runs_agency_id_idx on tender_scoring_runs (agency_id);
create unique index tender_scoring_runs_current_unique
  on tender_scoring_runs (tender_id, agency_id)
  where is_current;
create unique index tender_scoring_runs_one_active_per_tender_agency
  on tender_scoring_runs (tender_id, agency_id)
  where status in ('QUEUED', 'RUNNING');
create trigger tender_scoring_runs_set_updated_at
  before update on tender_scoring_runs
  for each row execute function set_updated_at();

-- One row per dimension per run (Phase 10 §21/§26) — always exactly the
-- six dimensions, even when UNKNOWN, so "what happened to Strategic Fit"
-- is always answerable from the run without guessing.
create table tender_score_components (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references tender_scoring_runs(id) on delete cascade,
  dimension opportunity_score_dimension not null,
  status opportunity_component_status not null default 'UNKNOWN',
  score numeric,
  weight numeric not null,
  explanation text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint tender_score_components_unique unique (run_id, dimension),
  constraint tender_score_components_score_range check (score is null or score between 0 and 100),
  constraint tender_score_components_score_requires_known check (
    (status = 'KNOWN' and score is not null) or (status <> 'KNOWN' and score is null)
  )
);
create index tender_score_components_run_id_idx on tender_score_components (run_id);

create table tender_score_drivers (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references tender_scoring_runs(id) on delete cascade,
  dimension opportunity_score_dimension,
  description text not null,
  evidence jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index tender_score_drivers_run_id_idx on tender_score_drivers (run_id);

create table tender_score_risks (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references tender_scoring_runs(id) on delete cascade,
  dimension opportunity_score_dimension,
  description text not null,
  evidence jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index tender_score_risks_run_id_idx on tender_score_risks (run_id);

-- Hard gates (Phase 10 §29) — always one row per gate TYPE that was
-- actually evaluated (not just the triggered ones), so "why isn't this
-- BLOCKED" is answerable ("briefing gate = UNKNOWN, attendance not yet
-- confirmed") as well as "why is this BLOCKED".
create table tender_score_gates (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references tender_scoring_runs(id) on delete cascade,
  gate_type opportunity_gate_type not null,
  status opportunity_gate_status not null default 'UNKNOWN',
  description text not null,
  evidence jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  constraint tender_score_gates_unique unique (run_id, gate_type)
);
create index tender_score_gates_run_id_idx on tender_score_gates (run_id);

-- ---------------------------------------------------------------
-- RLS. scoring_configurations/versions are a shared, non-agency-specific
-- catalogue (same shape as tender_requirements) — readable by any
-- authenticated user, no authenticated write policy (admin mutation goes
-- through the service-role client behind requireRole(['ADMIN']) at the
-- route layer, Phase 10 §37). Everything else is agency-scoped exactly
-- like tender_qualification_runs (Phase 8 §36/Phase 10 §36).
-- ---------------------------------------------------------------
alter table scoring_configurations enable row level security;
create policy scoring_configurations_select_authenticated on scoring_configurations
  for select to authenticated using (true);

alter table scoring_configuration_versions enable row level security;
create policy scoring_configuration_versions_select_authenticated on scoring_configuration_versions
  for select to authenticated using (true);

alter table tender_scoring_runs enable row level security;
create policy tender_scoring_runs_select_own_agency on tender_scoring_runs
  for select to authenticated using (agency_id = current_agency_id());

do $$
declare
  t text;
begin
  foreach t in array array['tender_score_components', 'tender_score_drivers', 'tender_score_risks', 'tender_score_gates']
  loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy %I on %I for select to authenticated using (exists (select 1 from tender_scoring_runs r where r.id = %I.run_id and r.agency_id = current_agency_id()))',
      t || '_select_own_agency', t, t
    );
  end loop;
end $$;

-- No authenticated insert/update/delete policy on any table in this
-- migration — service-role only, same convention as every prior phase.
-- Writes go through apps/api/src/lib/scoring/supabaseScoringStore.ts and
-- routes/tenderScoring.ts using the privileged client.

-- ---------------------------------------------------------------
-- 5. Seed the default scoring configuration (Phase 10 §5/§6/§8/§15/§24 —
--    the exact example values from the spec, made real/queryable rather
--    than hard-coded in TypeScript). Application code
--    (apps/api/src/lib/scoring/defaultConfig.ts) reads this by name
--    ('default') rather than re-deriving it, so the seed here and the
--    fallback used when no DB is configured (tests) stay in lockstep by
--    convention, not by import (documented in docs/SCORING-ENGINE.md).
-- ---------------------------------------------------------------
insert into scoring_configurations (id, name, description, is_active)
values ('00000000-0000-0000-0000-000000000010', 'default', 'Phase 10 default opportunity scoring configuration.', true);

insert into scoring_configuration_versions (
  id, configuration_id, version, dimension_weights, qualification_status_score_map, requirement_coverage_value_map,
  evaluation_fit_value_map, evidence_state_value_map, decision_bands, data_completeness_insufficient_threshold, critical_dimensions, is_current
) values (
  '00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000000010',
  1,
  '{"QUALIFICATION": 0.20, "REQUIREMENT_COVERAGE": 0.20, "EVALUATION_FIT": 0.20, "EVIDENCE_STRENGTH": 0.15, "COMMERCIAL_FIT": 0.15, "STRATEGIC_FIT": 0.10}'::jsonb,
  '{"ELIGIBLE": 100, "ACTION_REQUIRED": 60, "REQUIRES_REVIEW": 40, "UNKNOWN": 20, "NOT_ELIGIBLE": 0}'::jsonb,
  '{"SUPPORTED": 1, "PARTIALLY_SUPPORTED": 0.5, "UNKNOWN": 0, "ACTION_REQUIRED": 0, "FAILED": 0, "NOT_APPLICABLE": null}'::jsonb,
  '{"STRONG": 1, "MODERATE": 0.6, "WEAK": 0.3}'::jsonb,
  '{"VERIFIED": 1, "UNVERIFIED": 0.5, "UNKNOWN": 0, "MISSING": 0, "EXPIRED": 0}'::jsonb,
  '[{"min": 80, "max": 100, "signal": "HIGH_PRIORITY"}, {"min": 65, "max": 79, "signal": "PROMISING"}, {"min": 50, "max": 64, "signal": "REVIEW"}, {"min": 0, "max": 49, "signal": "LOW_PRIORITY"}]'::jsonb,
  0.5,
  '["QUALIFICATION", "REQUIREMENT_COVERAGE"]'::jsonb,
  true
);
