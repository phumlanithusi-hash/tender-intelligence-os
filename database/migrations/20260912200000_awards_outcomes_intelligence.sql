-- Phase 17 — Awards, Outcomes, Win/Loss Intelligence & Procurement
-- Learning. Extends (never duplicates) the Phase 2 `awards` /
-- `competitors` / `competitor_activity` tables. Closes the loop:
-- DISCOVER→...→SUBMISSION→RECEIPT→AWARD/OUTCOME→WIN/LOSS→LEARN.
--
-- Three layers kept strictly separate throughout (spec §3/§113):
--   1. FACT       — tender_outcomes (what an authoritative source says
--                    happened to the tender).
--   2. HUMAN/FACT — bid_outcomes + loss_reasons (what happened to OUR
--                    bid — reconciled deterministically from Phase 16
--                    submission state + tender_outcomes, never guessed).
--   3. LEARNING    — outcome_decision_time_features /
--                    outcome_result_features, split into two tables
--                    specifically so a post-outcome fact (award_value,
--                    winner, loss_reason, winning_score) can never leak
--                    into a "what did we know before we decided" row
--                    (spec §79 data-leakage protection).
--
-- RLS follows the exact two conventions already established
-- (database/migrations/20260910200180_rls_policies.sql,
-- 20260912000000_submission_execution.sql): shared catalogue tables
-- (tender_outcomes, outcome_conflicts — public procurement facts) are
-- select-only for `authenticated`, service-role-only writes; agency
-- tables (bid_outcomes, loss_reasons, the two feature tables) are
-- agency_id = current_agency_id() select-only for `authenticated`,
-- service-role-only writes via apps/api/src/lib/outcomes/*.

-- ---------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------
create type outcome_status as enum (
  'UNKNOWN', 'OPEN', 'AWARD_PENDING', 'AWARDED', 'CANCELLED', 'WITHDRAWN', 'NO_AWARD', 'DISPUTED'
);

-- Separate from tender outcome status (spec §7) — a tender can be
-- AWARDED while our own bid result is UNKNOWN, LOST, etc.
create type bid_result as enum (
  'NOT_SUBMITTED', 'SUBMITTED', 'WON', 'LOST', 'DISQUALIFIED', 'WITHDRAWN', 'UNKNOWN'
);

create type outcome_provenance as enum (
  'OFFICIAL_SOURCE', 'TENDER_DOCUMENT', 'PROVIDER_RECEIPT', 'AGENCY_RECORD', 'HUMAN_REPORTED', 'SYSTEM_CALCULATED', 'OTHER'
);

create type loss_reason_category as enum (
  'PRICE', 'EVALUATION_SCORE', 'TECHNICAL_NON_COMPLIANCE', 'MANDATORY_REQUIREMENT',
  'LATE_SUBMISSION', 'INCOMPLETE_SUBMISSION', 'INSUFFICIENT_EVIDENCE', 'CAPACITY',
  'EXPERIENCE', 'BEE_SOCIO_ECONOMIC', 'LOCAL_CONTENT', 'PRESENTATION', 'BRIEFING',
  'COMMERCIAL_TERMS', 'STRATEGIC_FIT', 'WITHDRAWN', 'CLIENT_CANCELLED', 'UNKNOWN', 'OTHER'
);

create type loss_reason_provenance as enum ('OFFICIAL', 'HUMAN_REPORTED', 'SYSTEM_INFERRED', 'UNKNOWN');

create type outcome_conflict_status as enum ('OPEN', 'RESOLVED', 'DISMISSED');

-- Competitor data quality (spec §65) — distinct from evidence_status
-- vocabulary because "OBSERVED" (seen mentioned, not corroborated) is
-- a meaningful state here that evidence_status does not carry.
create type competitor_data_quality as enum ('OBSERVED', 'VERIFIED', 'INFERRED', 'UNKNOWN');

-- The competitor's own recorded role/result on one tender (spec §12).
-- Deliberately new rather than overloading the existing
-- competitor_activity_type enum (BID_PARTICIPATION/AWARD/WITHDRAWAL/OTHER),
-- which describes the *activity record type*, not the *result*.
create type competitor_result as enum ('BIDDER', 'WINNER', 'SHORTLISTED', 'DISQUALIFIED', 'UNKNOWN');

-- ---------------------------------------------------------------
-- 2. tender_outcomes — the FACT layer. Append-only/versioned: a
-- correction inserts a new row (supersedes_id -> the row it replaces)
-- rather than overwriting history (spec §59/§60).
-- ---------------------------------------------------------------
create table tender_outcomes (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references tenders(id) on delete cascade,
  -- Optional link to the Phase 2 awards row this outcome was recorded
  -- alongside/derived from, where one already exists — never a second
  -- copy of the same concept, just a cross-reference (spec §1/§5).
  award_id uuid references awards(id),
  outcome_status outcome_status not null default 'UNKNOWN',
  published_date date,
  decision_date date,
  winner_name text,
  winner_registration_number text,
  winner_province text,
  winner_entity_type text,
  award_value numeric,
  award_currency text not null default 'ZAR',
  contract_duration text,
  procurement_method text,
  source_url text,
  source_document_id uuid references tender_documents(id),
  -- Free-text description of where an evidence reference resolves to
  -- (e.g. "tender_documents:<id>#page=3") when it isn't a plain
  -- document id — never treated as authoritative by itself (spec §16).
  source_evidence_ref text,
  truth_status evidence_status not null default 'UNKNOWN',
  provenance outcome_provenance not null default 'OTHER',
  recorded_by uuid references users(id),
  recorded_at timestamptz not null default now(),
  verified_by uuid references users(id),
  verified_at timestamptz,
  notes text,
  is_current boolean not null default true,
  version integer not null default 1,
  supersedes_id uuid references tender_outcomes(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tender_outcomes_award_value_non_negative check (award_value is null or award_value >= 0),
  constraint tender_outcomes_verified_requires_verifier
    check (truth_status <> 'VERIFIED' or (verified_by is not null and verified_at is not null))
);

create index tender_outcomes_tender_id_idx on tender_outcomes (tender_id);
create index tender_outcomes_status_idx on tender_outcomes (outcome_status);
create index tender_outcomes_decision_date_idx on tender_outcomes (decision_date);
create index tender_outcomes_winner_idx on tender_outcomes (winner_name);
-- Only one current outcome record per tender at a time.
create unique index tender_outcomes_one_current_per_tender
  on tender_outcomes (tender_id) where is_current;

create trigger tender_outcomes_set_updated_at
  before update on tender_outcomes
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------
-- 3. outcome_conflicts — detected disagreement between sources about
-- one tender_outcomes field. Never auto-resolved (spec §17).
-- ---------------------------------------------------------------
create table outcome_conflicts (
  id uuid primary key default gen_random_uuid(),
  tender_outcome_id uuid not null references tender_outcomes(id) on delete cascade,
  field_name text not null,
  existing_value text,
  conflicting_value text,
  existing_source text,
  conflicting_source text,
  existing_authority_level authority_level,
  conflicting_authority_level authority_level,
  status outcome_conflict_status not null default 'OPEN',
  discovered_at timestamptz not null default now(),
  resolved_by uuid references users(id),
  resolved_at timestamptz,
  resolution_notes text,
  created_at timestamptz not null default now(),
  constraint outcome_conflicts_resolved_requires_resolver
    check (status = 'OPEN' or (resolved_by is not null and resolved_at is not null))
);

create index outcome_conflicts_tender_outcome_id_idx on outcome_conflicts (tender_outcome_id);
create index outcome_conflicts_status_idx on outcome_conflicts (status);

-- ---------------------------------------------------------------
-- 4. bid_outcomes — OUR result on one bid project. Deterministically
-- reconciled from Phase 16 submission state + tender_outcomes (spec
-- §23/§24), never hand-set to WON/LOST without that basis being
-- recorded in reconciliation_basis.
-- ---------------------------------------------------------------
create table bid_outcomes (
  id uuid primary key default gen_random_uuid(),
  bid_project_id uuid not null references bid_strategy_projects(id) on delete cascade,
  agency_id uuid not null references agencies(id) on delete cascade,
  tender_id uuid not null references tenders(id),
  tender_outcome_id uuid references tender_outcomes(id),
  our_result bid_result not null default 'UNKNOWN',
  our_rank integer,
  our_score numeric,
  winning_score numeric,
  disqualification_reason text,
  -- Snapshot of the Phase 16 submission status this reconciliation was
  -- computed from (spec §23): VERIFIED_SUBMITTED / SUBMISSION_REPORTED
  -- / NOT_SUBMITTED / UNKNOWN.
  submission_status_snapshot text not null default 'UNKNOWN',
  reconciliation_basis text,
  reconciled_at timestamptz,
  truth_status evidence_status not null default 'UNKNOWN',
  provenance outcome_provenance not null default 'SYSTEM_CALCULATED',
  recorded_by uuid references users(id),
  recorded_at timestamptz not null default now(),
  verified_by uuid references users(id),
  verified_at timestamptz,
  notes text,
  is_current boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bid_outcomes_verified_requires_verifier
    check (truth_status <> 'VERIFIED' or (verified_by is not null and verified_at is not null))
);

create index bid_outcomes_bid_project_id_idx on bid_outcomes (bid_project_id);
create index bid_outcomes_agency_id_idx on bid_outcomes (agency_id);
create index bid_outcomes_tender_id_idx on bid_outcomes (tender_id);
create index bid_outcomes_our_result_idx on bid_outcomes (our_result);
create unique index bid_outcomes_one_current_per_project
  on bid_outcomes (bid_project_id) where is_current;

create trigger bid_outcomes_set_updated_at
  before update on bid_outcomes
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------
-- 5. loss_reasons — zero, one or many per bid_outcome; at most one
-- marked primary (spec §21).
-- ---------------------------------------------------------------
create table loss_reasons (
  id uuid primary key default gen_random_uuid(),
  bid_outcome_id uuid not null references bid_outcomes(id) on delete cascade,
  agency_id uuid not null references agencies(id) on delete cascade,
  category loss_reason_category not null default 'UNKNOWN',
  is_primary boolean not null default false,
  provenance loss_reason_provenance not null default 'UNKNOWN',
  source_document_id uuid references tender_documents(id),
  notes text,
  recorded_by uuid references users(id),
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index loss_reasons_bid_outcome_id_idx on loss_reasons (bid_outcome_id);
create index loss_reasons_agency_id_idx on loss_reasons (agency_id);
create unique index loss_reasons_one_primary_per_outcome
  on loss_reasons (bid_outcome_id) where is_primary;

-- ---------------------------------------------------------------
-- 6. Extend competitors / competitor_activity (spec §11/§12) — reuse,
-- never duplicate, the Phase 2 tables.
-- ---------------------------------------------------------------
alter table competitors add column normalized_name text;
alter table competitors add column registration_number text;
alter table competitors add column website text;
alter table competitors add column province text;
alter table competitors add column entity_type text;
alter table competitors add column first_seen_at timestamptz not null default now();
alter table competitors add column last_seen_at timestamptz not null default now();
alter table competitors add column data_quality competitor_data_quality not null default 'UNKNOWN';

alter table competitor_activity add column result competitor_result not null default 'UNKNOWN';
alter table competitor_activity add column rank integer;
alter table competitor_activity add column evidence_document_id uuid references tender_documents(id);

-- ---------------------------------------------------------------
-- 7. Learning foundation — split decision-time vs outcome features
-- (spec §43/§44/§78/§79). These are the ONLY two tables the future
-- learning layer may read from; each row is written once and never
-- edited (append/replace-only via is_current, mirroring
-- bid_submission_receipts' immutability trigger).
-- ---------------------------------------------------------------
create table outcome_decision_time_features (
  id uuid primary key default gen_random_uuid(),
  bid_project_id uuid not null references bid_strategy_projects(id) on delete cascade,
  agency_id uuid not null references agencies(id) on delete cascade,
  tender_id uuid not null references tenders(id),
  bid_decision_run_id uuid references bid_decision_runs(id),
  scoring_run_id uuid references tender_scoring_runs(id),
  scoring_configuration_version_id uuid references scoring_configuration_versions(id),
  bid_policy_version_id uuid references bid_policy_versions(id),
  bid_strategy_version integer,
  tender_category text,
  organisation_type text,
  province text,
  estimated_value_band text,
  qualification_status_at_decision text,
  requirement_coverage_at_decision numeric,
  evaluation_fit_at_decision numeric,
  evidence_strength_at_decision numeric,
  commercial_fit_at_decision numeric,
  strategic_fit_at_decision numeric,
  opportunity_score_at_decision numeric,
  bid_effort text,
  bid_decision text,
  submission_method text,
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint outcome_decision_time_features_one_per_project unique (bid_project_id)
);

create index outcome_decision_time_features_agency_id_idx on outcome_decision_time_features (agency_id);
create index outcome_decision_time_features_tender_id_idx on outcome_decision_time_features (tender_id);

create function prevent_decision_time_feature_mutation() returns trigger as $$
begin
  raise exception 'outcome_decision_time_features: row % is immutable once captured (spec §44/§80 temporal integrity) — insert a new bid_project_id row instead.', old.id;
  return new;
end;
$$ language plpgsql;
create trigger outcome_decision_time_features_immutable
  before update on outcome_decision_time_features
  for each row execute function prevent_decision_time_feature_mutation();

-- Post-outcome features — the ONLY table permitted to carry
-- award_value / winner / loss_reason / winning_score-derived fields
-- for learning purposes (spec §79). Never joined into a query that
-- also claims to represent "what was known before submission".
create table outcome_result_features (
  id uuid primary key default gen_random_uuid(),
  bid_project_id uuid not null references bid_strategy_projects(id) on delete cascade,
  agency_id uuid not null references agencies(id) on delete cascade,
  tender_id uuid not null references tenders(id),
  bid_outcome_id uuid references bid_outcomes(id),
  our_result text,
  outcome_status text,
  submission_success boolean,
  award_value numeric,
  loss_reason_primary text,
  winning_score numeric,
  captured_at timestamptz not null default now(),
  constraint outcome_result_features_one_per_project unique (bid_project_id)
);

create index outcome_result_features_agency_id_idx on outcome_result_features (agency_id);
create index outcome_result_features_tender_id_idx on outcome_result_features (tender_id);

-- ---------------------------------------------------------------
-- 8. RLS
-- ---------------------------------------------------------------
-- Shared catalogue tables (public procurement facts) — same shape as
-- awards/competitors/competitor_activity already are.
do $$
declare
  t text;
begin
  foreach t in array array['tender_outcomes', 'outcome_conflicts']
  loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy %I on %I for select to authenticated using (true)',
      t || '_select_authenticated', t
    );
  end loop;
end $$;

-- Agency-owned tables — direct agency_id column on all four.
do $$
declare
  t text;
begin
  foreach t in array array[
    'bid_outcomes', 'loss_reasons', 'outcome_decision_time_features', 'outcome_result_features'
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
-- 9. Audit log event types used by Phase 17 (spec §74) — audit_logs.action
-- is free text (see 20260910200170_notifications_audit.sql), so no enum
-- change is needed; the fixed vocabulary
-- (OUTCOME_CREATED/OUTCOME_UPDATED/OUTCOME_VERIFIED/OUTCOME_REJECTED/
-- OUTCOME_CONFLICT_CREATED/OUTCOME_CONFLICT_RESOLVED/WIN_RECORDED/
-- LOSS_RECORDED/LOSS_REASON_ADDED/COMPETITOR_RECORDED/ANALYTICS_GENERATED)
-- is enforced in application code (apps/api/src/lib/outcomes/audit.ts)
-- exactly as Phase 15/16's action strings are.
