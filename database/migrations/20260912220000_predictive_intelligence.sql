-- Phase 18 — Predictive Procurement Intelligence, Calibration & Decision
-- Support. Builds ON TOP of (never duplicates) Phase 17's learning
-- foundation: outcome_decision_time_features / outcome_result_features
-- remain the only source of decision-time and post-outcome facts.
--
-- Every table here is agency-scoped (spec §26 "private feature datasets,
-- private model artifacts") — a model is trained per-agency, on that
-- agency's own verified bid history, never pooled across agencies.
--
-- Governance/immutability conventions (spec §6/§19/§24/§27):
--   - model_versions rows are immutable after insert except the
--     `status`/retirement columns, enforced by a trigger — a version's
--     training/feature/period/hyperparameter facts can never be rewritten.
--   - model_predictions rows are fully immutable after insert (no
--     UPDATE at all) — a prediction, once made, is a historical fact.
--   - model_calibrations rows are immutable after insert — a new
--     calibration is always a new row (new calibration_version), never
--     an edit of an old one.
--   - is_test_fixture marks rows created by the test suite so a test
--     fixture can never be mistaken for (or accidentally queried as)
--     production training data (spec §3/§33).
--
-- RLS follows the established agency-owned convention exactly
-- (agency_id = current_agency_id() select-only for authenticated,
-- service-role-only writes via apps/api/src/lib/intelligence/*).

-- ---------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------
create type model_eligibility_state as enum (
  'INSUFFICIENT_DATA', 'INSUFFICIENT_LABELS', 'INSUFFICIENT_VARIATION',
  'HIGH_CLASS_IMBALANCE', 'LEAKAGE_DETECTED', 'READY_FOR_TRAINING',
  'READY_FOR_EVALUATION', 'PRODUCTION_ELIGIBLE'
);

create type model_status as enum (
  'EXPERIMENTAL', 'EVALUATED', 'CALIBRATED', 'PRODUCTION_CANDIDATE', 'PRODUCTION', 'RETIRED', 'FAILED'
);

create type model_type as enum ('PREVALENCE_BASELINE', 'OPPORTUNITY_SCORE_BASELINE', 'LOGISTIC_REGRESSION');

create type abstention_reason as enum (
  'INSUFFICIENT_VERIFIED_OUTCOMES', 'INSUFFICIENT_SEGMENT_SAMPLE', 'MISSING_CRITICAL_FEATURES',
  'OUTSIDE_SUPPORTED_RANGE', 'DISTRIBUTION_SHIFT', 'CALIBRATION_INSUFFICIENT', 'LEAKAGE_DETECTED',
  'MODEL_NOT_PRODUCTION_ELIGIBLE'
);

create type model_promotion_action as enum ('PROMOTE', 'REJECT', 'RETIRE');
create type calibration_method as enum ('NONE', 'PLATT', 'ISOTONIC');
create type evaluation_type as enum ('BASELINE_PREVALENCE', 'BASELINE_OPPORTUNITY_SCORE', 'MODEL');
create type training_run_status as enum ('SKIPPED_INSUFFICIENT_DATA', 'RUNNING', 'COMPLETED', 'FAILED');

-- ---------------------------------------------------------------
-- 2. model_registry — one row per named model family per agency.
-- ---------------------------------------------------------------
create table model_registry (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  name text not null,
  prediction_target text not null default 'VERIFIED_BID_OUTCOME_WON_LOST',
  description text,
  created_at timestamptz not null default now(),
  created_by uuid references users(id),
  constraint model_registry_unique_name_per_agency unique (agency_id, name)
);
create index model_registry_agency_id_idx on model_registry (agency_id);

-- ---------------------------------------------------------------
-- 3. model_datasets — one immutable snapshot per (agency, dataset
-- version). This is the readiness-gate output, computed from Phase 17
-- tables only, never from live/future data (spec §3/§8/§9).
-- ---------------------------------------------------------------
create table model_datasets (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  dataset_version integer not null,
  prediction_target text not null default 'VERIFIED_BID_OUTCOME_WON_LOST',
  feature_generation_version text not null default 'v1',
  total_candidate_records integer not null default 0,
  verified_labelled_records integer not null default 0,
  positive_count integer not null default 0,
  negative_count integer not null default 0,
  class_balance numeric,
  feature_completeness numeric,
  temporal_coverage_start date,
  temporal_coverage_end date,
  duplicate_rate numeric not null default 0,
  leakage_check_passed boolean not null default false,
  leakage_findings jsonb not null default '[]'::jsonb,
  segment_coverage jsonb not null default '{}'::jsonb,
  eligibility_state model_eligibility_state not null,
  eligibility_reasons jsonb not null default '[]'::jsonb,
  is_test_fixture boolean not null default false,
  generated_at timestamptz not null default now(),
  generated_by uuid references users(id),
  constraint model_datasets_unique_version_per_agency unique (agency_id, dataset_version),
  constraint model_datasets_counts_consistent check (positive_count + negative_count <= verified_labelled_records)
);
create index model_datasets_agency_id_idx on model_datasets (agency_id);
create index model_datasets_eligibility_idx on model_datasets (eligibility_state);

-- ---------------------------------------------------------------
-- 4. model_versions — immutable per-version training facts + a
-- mutable governance status (spec §19).
-- ---------------------------------------------------------------
create table model_versions (
  id uuid primary key default gen_random_uuid(),
  model_registry_id uuid not null references model_registry(id) on delete cascade,
  agency_id uuid not null references agencies(id) on delete cascade,
  version integer not null,
  model_type model_type not null,
  dataset_id uuid not null references model_datasets(id),
  feature_generation_version text not null default 'v1',
  training_period_start date,
  training_period_end date,
  validation_period_start date,
  validation_period_end date,
  test_period_start date,
  test_period_end date,
  hyperparameters jsonb not null default '{}'::jsonb,
  training_sample_count integer not null default 0,
  positive_sample_count integer not null default 0,
  negative_sample_count integer not null default 0,
  status model_status not null default 'EXPERIMENTAL',
  is_test_fixture boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references users(id),
  retired_at timestamptz,
  retired_by uuid references users(id),
  retirement_reason text,
  constraint model_versions_unique_version_per_registry unique (model_registry_id, version),
  constraint model_versions_retirement_requires_reason check (status <> 'RETIRED' or (retired_at is not null and retirement_reason is not null))
);
create index model_versions_registry_id_idx on model_versions (model_registry_id);
create index model_versions_agency_id_idx on model_versions (agency_id);
create index model_versions_status_idx on model_versions (status);

-- Immutability: only status/retirement columns may change after insert.
create function prevent_model_version_core_mutation() returns trigger as $$
begin
  if new.model_registry_id <> old.model_registry_id
     or new.agency_id <> old.agency_id
     or new.version <> old.version
     or new.model_type <> old.model_type
     or new.dataset_id <> old.dataset_id
     or new.training_sample_count <> old.training_sample_count
     or new.positive_sample_count <> old.positive_sample_count
     or new.negative_sample_count <> old.negative_sample_count
     or coalesce(new.hyperparameters, '{}'::jsonb) <> coalesce(old.hyperparameters, '{}'::jsonb)
  then
    raise exception 'model_versions: row % core training facts are immutable (spec §19) — only status/retirement fields may change.', old.id;
  end if;
  return new;
end;
$$ language plpgsql;
create trigger model_versions_core_immutable
  before update on model_versions
  for each row execute function prevent_model_version_core_mutation();

-- ---------------------------------------------------------------
-- 5. model_training_runs — one row per training attempt (including a
-- SKIPPED_INSUFFICIENT_DATA attempt — spec §33 "continue implementing
-- the architecture" even when no real training executes).
-- ---------------------------------------------------------------
create table model_training_runs (
  id uuid primary key default gen_random_uuid(),
  model_version_id uuid not null references model_versions(id) on delete cascade,
  agency_id uuid not null references agencies(id) on delete cascade,
  dataset_id uuid not null references model_datasets(id),
  status training_run_status not null default 'RUNNING',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  notes text,
  is_test_fixture boolean not null default false
);
create index model_training_runs_version_id_idx on model_training_runs (model_version_id);
create index model_training_runs_agency_id_idx on model_training_runs (agency_id);

-- ---------------------------------------------------------------
-- 6. model_evaluations — baselines + model, always sample-sized
-- (spec §7/§10).
-- ---------------------------------------------------------------
create table model_evaluations (
  id uuid primary key default gen_random_uuid(),
  model_version_id uuid not null references model_versions(id) on delete cascade,
  agency_id uuid not null references agencies(id) on delete cascade,
  evaluation_type evaluation_type not null,
  sample_size integer not null,
  auc numeric,
  pr_auc numeric,
  precision_score numeric,
  recall_score numeric,
  f1_score numeric,
  brier_score numeric,
  log_loss_score numeric,
  confusion_matrix jsonb,
  validation_period_start date,
  validation_period_end date,
  is_test_fixture boolean not null default false,
  evaluated_at timestamptz not null default now(),
  constraint model_evaluations_sample_size_positive check (sample_size >= 0)
);
create index model_evaluations_version_id_idx on model_evaluations (model_version_id);
create index model_evaluations_agency_id_idx on model_evaluations (agency_id);
create index model_evaluations_type_idx on model_evaluations (evaluation_type);

-- ---------------------------------------------------------------
-- 7. model_calibrations — immutable, versioned (spec §11).
-- ---------------------------------------------------------------
create table model_calibrations (
  id uuid primary key default gen_random_uuid(),
  model_version_id uuid not null references model_versions(id) on delete cascade,
  agency_id uuid not null references agencies(id) on delete cascade,
  calibration_version integer not null,
  method calibration_method not null default 'NONE',
  buckets jsonb not null default '[]'::jsonb,
  brier_score numeric,
  calibration_error numeric,
  sample_size integer not null default 0,
  training_period_start date,
  training_period_end date,
  validation_period_start date,
  validation_period_end date,
  is_test_fixture boolean not null default false,
  created_at timestamptz not null default now(),
  constraint model_calibrations_unique_version unique (model_version_id, calibration_version)
);
create index model_calibrations_version_id_idx on model_calibrations (model_version_id);
create index model_calibrations_agency_id_idx on model_calibrations (agency_id);

create function prevent_model_calibration_mutation() returns trigger as $$
begin
  raise exception 'model_calibrations: row % is immutable once created (spec §11/§24) — insert a new calibration_version instead.', old.id;
  return new;
end;
$$ language plpgsql;
create trigger model_calibrations_immutable
  before update on model_calibrations
  for each row execute function prevent_model_calibration_mutation();

-- ---------------------------------------------------------------
-- 8. model_predictions — fully immutable historical fact (spec §24).
-- model_version_id is nullable: a prediction attempt that abstains
-- because NO model is production-eligible still gets a row here (with
-- abstained = true) so the audit trail is complete even when there is
-- nothing to predict with.
-- ---------------------------------------------------------------
create table model_predictions (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  bid_project_id uuid not null references bid_strategy_projects(id) on delete cascade,
  tender_id uuid not null references tenders(id),
  model_version_id uuid references model_versions(id),
  calibration_id uuid references model_calibrations(id),
  decision_time_feature_id uuid references outcome_decision_time_features(id),
  predicted_probability numeric,
  abstained boolean not null default false,
  feature_snapshot jsonb not null default '{}'::jsonb,
  data_completeness numeric,
  model_version_label text,
  prediction_timestamp timestamptz not null default now(),
  is_test_fixture boolean not null default false,
  constraint model_predictions_probability_range check (predicted_probability is null or (predicted_probability >= 0 and predicted_probability <= 1)),
  constraint model_predictions_abstained_has_no_probability check (not abstained or predicted_probability is null)
);
create index model_predictions_agency_id_idx on model_predictions (agency_id);
create index model_predictions_bid_project_id_idx on model_predictions (bid_project_id);
create index model_predictions_model_version_id_idx on model_predictions (model_version_id);

create function prevent_model_prediction_mutation() returns trigger as $$
begin
  raise exception 'model_predictions: row % is immutable once made (spec §24) — a prediction is a historical fact.', old.id;
  return new;
end;
$$ language plpgsql;
create trigger model_predictions_immutable
  before update on model_predictions
  for each row execute function prevent_model_prediction_mutation();

-- ---------------------------------------------------------------
-- 9. model_prediction_explanations — one per prediction (spec §14).
-- ---------------------------------------------------------------
create table model_prediction_explanations (
  id uuid primary key default gen_random_uuid(),
  prediction_id uuid not null references model_predictions(id) on delete cascade,
  agency_id uuid not null references agencies(id) on delete cascade,
  top_positive_features jsonb not null default '[]'::jsonb,
  top_negative_features jsonb not null default '[]'::jsonb,
  missing_features jsonb not null default '[]'::jsonb,
  explanation_text text not null,
  model_version_label text,
  created_at timestamptz not null default now(),
  constraint model_prediction_explanations_one_per_prediction unique (prediction_id)
);
create index model_prediction_explanations_agency_id_idx on model_prediction_explanations (agency_id);

-- ---------------------------------------------------------------
-- 10. model_abstentions — reason detail tied to an abstained
-- prediction (spec §13).
-- ---------------------------------------------------------------
create table model_abstentions (
  id uuid primary key default gen_random_uuid(),
  prediction_id uuid not null references model_predictions(id) on delete cascade,
  agency_id uuid not null references agencies(id) on delete cascade,
  reason abstention_reason not null,
  detail text,
  created_at timestamptz not null default now()
);
create index model_abstentions_agency_id_idx on model_abstentions (agency_id);
create index model_abstentions_prediction_id_idx on model_abstentions (prediction_id);

-- ---------------------------------------------------------------
-- 11. model_promotions — governance events: PROMOTE/REJECT/RETIRE,
-- always human-approved (spec §20/§30/§31).
-- ---------------------------------------------------------------
create table model_promotions (
  id uuid primary key default gen_random_uuid(),
  model_version_id uuid not null references model_versions(id) on delete cascade,
  agency_id uuid not null references agencies(id) on delete cascade,
  action model_promotion_action not null,
  from_status model_status not null,
  to_status model_status not null,
  approved_by uuid not null references users(id),
  approved_at timestamptz not null default now(),
  rationale text not null,
  sample_size_at_approval integer,
  known_limitations text
);
create index model_promotions_version_id_idx on model_promotions (model_version_id);
create index model_promotions_agency_id_idx on model_promotions (agency_id);

-- ---------------------------------------------------------------
-- 12. model_cards — one per production-candidate version (spec §23).
-- ---------------------------------------------------------------
create table model_cards (
  id uuid primary key default gen_random_uuid(),
  model_version_id uuid not null references model_versions(id) on delete cascade,
  agency_id uuid not null references agencies(id) on delete cascade,
  content jsonb not null,
  approval_status text not null default 'DRAFT',
  created_at timestamptz not null default now(),
  created_by uuid references users(id),
  constraint model_cards_one_per_version unique (model_version_id)
);
create index model_cards_agency_id_idx on model_cards (agency_id);

-- ---------------------------------------------------------------
-- 13. model_audit_events — dedicated model-governance audit trail
-- (spec §27), in addition to (never instead of) the shared
-- `audit_logs` table every other phase writes to.
-- ---------------------------------------------------------------
create table model_audit_events (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  model_version_id uuid references model_versions(id),
  event_type text not null,
  actor_id uuid references users(id),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index model_audit_events_agency_id_idx on model_audit_events (agency_id);
create index model_audit_events_version_id_idx on model_audit_events (model_version_id);

-- ---------------------------------------------------------------
-- 14. Production-model uniqueness: at most one PRODUCTION-status
-- version per model_registry_id at a time (spec §20/§30).
-- ---------------------------------------------------------------
create unique index model_versions_one_production_per_registry
  on model_versions (model_registry_id) where status = 'PRODUCTION';

-- ---------------------------------------------------------------
-- 15. RLS — agency-owned convention (every table above has a direct
-- agency_id column).
-- ---------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'model_registry', 'model_datasets', 'model_versions', 'model_training_runs',
    'model_evaluations', 'model_calibrations', 'model_predictions',
    'model_prediction_explanations', 'model_abstentions', 'model_promotions',
    'model_cards', 'model_audit_events'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy %I on %I for select to authenticated using (agency_id = current_agency_id())',
      t || '_select_own_agency', t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------
-- 16. Audit log event vocabulary used by Phase 18 (spec §27), written
-- into the existing free-text audit_logs.action exactly as prior
-- phases do: MODEL_DATASET_GENERATED, MODEL_VERSION_CREATED,
-- MODEL_TRAINING_RUN_STARTED/COMPLETED/SKIPPED, MODEL_EVALUATED,
-- MODEL_CALIBRATED, MODEL_PROMOTED, MODEL_REJECTED, MODEL_RETIRED,
-- PREDICTION_MADE, PREDICTION_ABSTAINED.
