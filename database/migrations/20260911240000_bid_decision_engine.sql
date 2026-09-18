-- Phase 11: Bid/No-Bid Intelligence Engine.
--
-- NAMING NOTE (binding constraint, see docs/DECISIONS.md — same
-- discipline as Phase 10's 20260911220000 header): this migration's
-- vocabulary (`bid_recommendation`, `bid_decision_runs`, ...) is
-- COMPLETELY SEPARATE from two pre-existing things:
--   1. `bid_decision` enum (20260910200010_enums.sql) and
--      `bid_projects.decision`/`decision_reason`/`decided_by`/
--      `decided_at` (20260910200150_bid_architecture.sql) — a
--      pre-existing Phase 2/3 UNSTRUCTURED human field
--      (PRIORITY_BID/BID/REVIEW/CONDITIONAL/NO_BID/UNDECIDED) with no
--      rule engine behind it. Left completely untouched. This phase's
--      engine writes to its own new tables with its own 3-value
--      vocabulary (BID/NO_BID/REVIEW) and is never merged with it.
--   2. Phase 10's `opportunity_decision_signal` (HIGH_PRIORITY/
--      PROMISING/REVIEW/LOW_PRIORITY/BLOCKED/INSUFFICIENT_DATA) — "how
--      attractive", read-only input to this phase, never mutated here.
--
-- Reviewed first, per the binding spec: tender_scoring_runs/
-- tender_score_components/tender_score_gates (Phase 10, read-only
-- input), tender_qualification_runs (Phase 8, read-only input via
-- Phase 10's own snapshot), tender_evaluation_conflicts (Phase 9,
-- read-only input), tender_requirements/tender_evaluation_criteria
-- (Phase 8/9, read-only input for bid-effort counts), audit_logs
-- (Phase 2 §22 — the existing generic, already-agency-scoped,
-- append-only audit table; reused as-is for Phase 11 §63 rather than
-- building a second audit system).

-- ---------------------------------------------------------------
-- 0. Enums.
-- ---------------------------------------------------------------
create type bid_recommendation as enum ('BID', 'NO_BID', 'REVIEW');
create type bid_rule_status as enum ('PASS', 'FAIL', 'UNKNOWN');
create type bid_rule_severity as enum ('HARD_BLOCK', 'NO_BID', 'REVIEW', 'WARNING');
create type bid_effort_level as enum ('LOW', 'MEDIUM', 'HIGH', 'UNKNOWN');
create type bid_decision_run_status as enum ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');
-- Phase 11 §61/§62 — future outcome-learning seam, unpopulated by this phase.
create type bid_decision_outcome as enum ('AWARD', 'LOSS', 'CANCELLED', 'NO_OUTCOME');

-- ---------------------------------------------------------------
-- 1. Bid policy — versioned agency configuration (Phase 11 §10-§12).
--    Deliberately a SEPARATE table/namespace from tender-side rule
--    tables (tender_evaluation_gates, tender_requirements.mandatory) —
--    Phase 11 §11 "business rules are not tender rules". One "policy"
--    (named, per agency) can have many versions; exactly one version
--    is `is_current` at a time. Historical decisions keep a reference
--    to the exact version that produced them (§12).
-- ---------------------------------------------------------------
create table bid_policies (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  name text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bid_policies_agency_name_unique unique (agency_id, name)
);
create index bid_policies_agency_id_idx on bid_policies (agency_id);
create trigger bid_policies_set_updated_at
  before update on bid_policies
  for each row execute function set_updated_at();

-- Every "rule config" field below follows the same shape:
-- { active: boolean, severity: 'HARD_BLOCK'|'NO_BID'|'REVIEW'|'WARNING', value: <threshold> }
-- stored as jsonb so a policy can be authored/edited as data (Phase 11
-- §13 "never hard-code 65"). A null jsonb column means "this rule is
-- not part of this policy at all" (distinct from `active: false`,
-- which means "configured but deliberately switched off").
create table bid_policy_versions (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references bid_policies(id) on delete cascade,
  version integer not null,
  -- Phase 11 §7 — the precedence order itself, stored as data.
  precedence jsonb not null default '["CONFIRMED_NO_BID_RULE","CLOSED_TENDER","NOT_ELIGIBLE","CONFIRMED_MANDATORY_FAILURE","CONFIRMED_SUBMISSION_IMPOSSIBILITY","QUALIFICATION_BLOCKER","MATERIAL_UNRESOLVED_RISK","INSUFFICIENT_DATA","POSITIVE_BID_RULE","DEFAULT_REVIEW"]'::jsonb,
  -- Phase 11 §5 — lets a hard gate be explicitly downgraded to REVIEW
  -- per rule id; any rule id absent here keeps its default HARD_BLOCK.
  hard_gate_overrides jsonb not null default '{}'::jsonb,
  minimum_opportunity_score jsonb,
  minimum_data_completeness jsonb,
  minimum_requirement_coverage jsonb,
  minimum_evidence_strength jsonb,
  minimum_evaluation_fit jsonb,
  minimum_strategic_fit jsonb,
  minimum_contract_value jsonb,
  preferred_contract_value numeric,
  minimum_preparation_days jsonb,
  maximum_preparation_days jsonb,
  -- Phase 11 §20 — always evaluated as UNKNOWN/WARNING: no real
  -- cost/pricing data source exists in this schema yet (documented
  -- limitation, not fabricated). Kept as a configurable field so the
  -- rule/UI seam already exists for when margin data does.
  minimum_expected_margin jsonb,
  maximum_bid_effort jsonb,
  preferred_services jsonb not null default '[]'::jsonb,
  preferred_sectors jsonb not null default '[]'::jsonb,
  preferred_organisation_types jsonb not null default '[]'::jsonb,
  preferred_provinces jsonb not null default '[]'::jsonb,
  excluded_organisation_types jsonb,
  excluded_sectors jsonb,
  unresolved_evaluation_conflict jsonb,
  -- Phase 11 §16 — severity per unknown-type, not uniform.
  unknown_severity jsonb not null default '{"COMMERCIAL_VALUE":"REVIEW","STRATEGIC_FIT":"CONTINUE","BRIEFING_ATTENDANCE":"REVIEW","EVALUATION_CONFLICT":"REVIEW","DEADLINE":"REVIEW"}'::jsonb,
  -- Phase 11 §14 — agency policy score bands, distinct from Phase 10's
  -- own tender-scoring bands; explanation/labelling only, never itself
  -- a decision rule.
  score_bands jsonb not null default '[{"min":80,"max":100,"label":"Strong bid candidate"},{"min":65,"max":79,"label":"Potentially bid"},{"min":50,"max":64,"label":"Review"},{"min":0,"max":49,"label":"Normally no-bid"}]'::jsonb,
  is_current boolean not null default true,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  constraint bid_policy_versions_unique unique (policy_id, version)
);
create index bid_policy_versions_policy_id_idx on bid_policy_versions (policy_id);
create unique index bid_policy_versions_current_unique
  on bid_policy_versions (policy_id)
  where is_current;

-- ---------------------------------------------------------------
-- 2. Bid decision runs — append-only (Phase 11 §39/§40), one current
--    run per tender+agency, agency-scoped exactly like
--    tender_scoring_runs. Human override fields live alongside the
--    system decision (Phase 11 §35/§38) — never mutating it.
-- ---------------------------------------------------------------
create table bid_decision_runs (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references tenders(id) on delete cascade,
  agency_id uuid not null references agencies(id) on delete cascade,
  status bid_decision_run_status not null default 'QUEUED',
  bid_policy_version_id uuid not null references bid_policy_versions(id),
  -- The exact Phase 10 scoring run this decision was computed from
  -- (Phase 11 §39/§65) — a reference, not a copy; staleness compares
  -- against whatever is current now (see input_snapshot).
  scoring_run_id uuid references tender_scoring_runs(id),
  system_decision bid_recommendation,
  human_decision bid_recommendation,
  final_decision bid_recommendation,
  override_reason text,
  overridden_by uuid references users(id),
  overridden_at timestamptz,
  bid_effort bid_effort_level not null default 'UNKNOWN',
  bid_effort_explanation text,
  decision_explanation text,
  is_current boolean not null default true,
  -- Snapshot of everything this decision consumed, for staleness
  -- comparison (Phase 11 §41) — mirrors tender_scoring_runs.input_snapshot.
  input_snapshot jsonb not null default '{}'::jsonb,
  -- Phase 11 §61/§62 — future outcome-learning seam. Never populated
  -- or inferred by this phase; a nullable column only.
  outcome bid_decision_outcome,
  outcome_recorded_at timestamptz,
  error text,
  triggered_by uuid references users(id),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Phase 11 §37 (binding constraint): override requires a non-null,
  -- non-empty reason, enforced at the DB level, not only the API.
  constraint bid_decision_runs_override_requires_reason check (
    human_decision is null
    or (override_reason is not null and length(btrim(override_reason)) > 0 and overridden_by is not null and overridden_at is not null)
  ),
  -- final_decision is always derivable but stored explicitly for cheap
  -- reads: human overrides when present, otherwise the system decision.
  constraint bid_decision_runs_final_decision_consistent check (
    (human_decision is not null and final_decision = human_decision)
    or (human_decision is null and (final_decision = system_decision or (final_decision is null and system_decision is null)))
  )
);
create index bid_decision_runs_tender_id_idx on bid_decision_runs (tender_id);
create index bid_decision_runs_agency_id_idx on bid_decision_runs (agency_id);
create unique index bid_decision_runs_current_unique
  on bid_decision_runs (tender_id, agency_id)
  where is_current;
create unique index bid_decision_runs_one_active_per_tender_agency
  on bid_decision_runs (tender_id, agency_id)
  where status in ('QUEUED', 'RUNNING');
create trigger bid_decision_runs_set_updated_at
  before update on bid_decision_runs
  for each row execute function set_updated_at();

-- One row per rule evaluated, every run, every rule (Phase 11 §29-§31)
-- — never only the first triggered rule.
create table bid_decision_rule_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references bid_decision_runs(id) on delete cascade,
  rule_id text not null,
  precedence_step text not null,
  status bid_rule_status not null default 'UNKNOWN',
  severity bid_rule_severity not null default 'WARNING',
  actual_value jsonb,
  expected_value jsonb,
  explanation text not null,
  created_at timestamptz not null default now(),
  constraint bid_decision_rule_results_unique unique (run_id, rule_id)
);
create index bid_decision_rule_results_run_id_idx on bid_decision_rule_results (run_id);

-- ---------------------------------------------------------------
-- RLS. bid_policies/versions are agency-owned configuration (unlike
-- Phase 10's shared scoring_configurations) — scoped to the owning
-- agency, same convention as agency_evidence tables. Decision runs and
-- rule results are agency-scoped exactly like tender_scoring_runs.
-- ---------------------------------------------------------------
alter table bid_policies enable row level security;
create policy bid_policies_select_own_agency on bid_policies
  for select to authenticated using (agency_id = current_agency_id());

alter table bid_policy_versions enable row level security;
create policy bid_policy_versions_select_own_agency on bid_policy_versions
  for select to authenticated using (
    exists (select 1 from bid_policies p where p.id = bid_policy_versions.policy_id and p.agency_id = current_agency_id())
  );

alter table bid_decision_runs enable row level security;
create policy bid_decision_runs_select_own_agency on bid_decision_runs
  for select to authenticated using (agency_id = current_agency_id());

alter table bid_decision_rule_results enable row level security;
create policy bid_decision_rule_results_select_own_agency on bid_decision_rule_results
  for select to authenticated using (
    exists (select 1 from bid_decision_runs r where r.id = bid_decision_rule_results.run_id and r.agency_id = current_agency_id())
  );

-- No authenticated insert/update/delete policy on any table in this
-- migration — service-role only, same convention as every prior
-- phase. Writes go through apps/api/src/lib/bidDecision/supabaseBidDecisionStore.ts
-- and routes/tenderBidDecision.ts using the privileged client, which
-- also enforces role gating (Phase 11 §36/§46) before ever reaching
-- these tables.

-- ---------------------------------------------------------------
-- 3. Seed a default bid policy per existing agency (Phase 11 §10) —
--    conservative defaults matching the spec's own worked examples,
--    made real/queryable rather than hard-coded in TypeScript (same
--    convention as Phase 10's default scoring configuration). Agencies
--    created after this migration get no policy row until one is
--    explicitly created — the engine then reports POLICY_NOT_CONFIGURED
--    rather than inventing thresholds (see lib/bidDecision/defaultPolicy.ts).
-- ---------------------------------------------------------------
insert into bid_policies (id, agency_id, name, description, is_active)
select gen_random_uuid(), a.id, 'default', 'Phase 11 default agency bid/no-bid policy.', true
from agencies a;

insert into bid_policy_versions (
  id, policy_id, version,
  minimum_opportunity_score, minimum_data_completeness, minimum_requirement_coverage,
  minimum_evidence_strength, minimum_evaluation_fit, minimum_preparation_days,
  unresolved_evaluation_conflict, is_current
)
select
  gen_random_uuid(), p.id, 1,
  '{"active": true, "severity": "NO_BID", "value": 65}'::jsonb,
  '{"active": true, "severity": "REVIEW", "value": 0.7}'::jsonb,
  '{"active": true, "severity": "REVIEW", "value": 75}'::jsonb,
  '{"active": true, "severity": "REVIEW", "value": 60}'::jsonb,
  '{"active": true, "severity": "REVIEW", "value": 50}'::jsonb,
  '{"active": true, "severity": "REVIEW", "value": 7}'::jsonb,
  '{"active": true, "severity": "REVIEW", "value": true}'::jsonb,
  true
from bid_policies p
where p.name = 'default';
