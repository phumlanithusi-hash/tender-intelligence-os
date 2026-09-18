-- Phase 12: Bid Strategy & Bid Project Intelligence.
--
-- COLLISION NOTE (binding discipline, documented in docs/DECISIONS.md,
-- same as Phase 10/11's own naming-collision headers): a table named
-- `bid_projects` ALREADY EXISTS (20260910200150_bid_architecture.sql,
-- Phase 2 §18) with a completely different lifecycle enum
-- (`bid_project_status`: DRAFTING/REVIEW/READY/SUBMITTED/WON/LOST/
-- WITHDRAWN) and a completely different purpose (an unstructured
-- `decision`/`decision_reason` human field, no rule engine, no
-- strategy concept). It is NOT referenced anywhere in
-- apps/api/src or apps/web/src (verified) — it is dead Phase 2/3
-- schema, exactly like `bid_projects.decision` was for Phase 11.
-- Reusing it would require silently reinterpreting its enum and
-- columns to mean something else, which the spec's own "extend, don't
-- duplicate — investigate thoroughly" instruction does NOT license
-- when the existing thing is a different concept with a different
-- state machine (the same reasoning Phase 11 used to keep
-- `bid_decision_runs` separate from `bid_projects.decision`). This
-- migration therefore introduces a new, clearly-named table,
-- `bid_strategy_projects`, for the Phase 12 "Bid Project" concept
-- (lifecycle DRAFT..CLOSED/CANCELLED), and leaves every Phase 2 legacy
-- bid_* table (bid_projects, bid_sections, bid_requirements,
-- bid_evidence, bid_documents, bid_versions, bid_reviews,
-- bid_submissions) completely untouched. No other Phase 12 table name
-- collides with anything pre-existing.
--
-- Reviewed first, per the binding spec: tender_requirements/
-- tender_evaluation_criteria (Phase 8/9, read-only input),
-- tender_qualification_runs (Phase 8, read-only), tender_scoring_runs
-- (Phase 10, read-only), bid_decision_runs (Phase 11, read-only —
-- a Bid Project references the exact decision run it was created
-- from), agency_evidence (read-only), audit_logs (Phase 2 §22,
-- reused as-is for Phase 12 §39, never a second audit system).

-- ---------------------------------------------------------------
-- 0. Enums.
-- ---------------------------------------------------------------
create type bid_strategy_project_status as enum ('DRAFT', 'STRATEGY', 'IN_PROGRESS', 'INTERNAL_REVIEW', 'READY_FOR_SUBMISSION', 'SUBMITTED', 'CLOSED', 'CANCELLED');
create type bid_strategy_priority as enum ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
create type bid_strategy_status as enum ('DRAFT', 'IN_REVIEW', 'APPROVED', 'SUPERSEDED');
create type bid_win_theme_source_type as enum ('TENDER_REQUIREMENT', 'EVALUATION_CRITERION', 'AGENCY_CAPABILITY', 'AGENCY_DIFFERENTIATOR', 'HUMAN_DEFINED');
create type bid_evidence_support_status as enum ('UNKNOWN', 'EVIDENCE_REQUIRED', 'SUPPORTED', 'PARTIALLY_SUPPORTED', 'UNVERIFIED');
create type bid_priority_class as enum ('CLIENT', 'TENDER');
create type bid_requirement_response_type as enum ('COMPLY', 'EXPLAIN', 'PROVIDE_DOCUMENT', 'PROVIDE_EVIDENCE', 'CLARIFY', 'REQUIRES_HUMAN_REVIEW', 'NOT_APPLICABLE');
create type bid_requirement_response_status as enum ('NOT_STARTED', 'IN_PROGRESS', 'READY', 'BLOCKED', 'REVIEW');
create type bid_evidence_need_status as enum ('OPEN', 'PARTIALLY_SATISFIED', 'SATISFIED', 'BLOCKED', 'WAIVED');
create type bid_workstream_category as enum ('STRATEGY', 'CONTENT', 'DESIGN', 'CASE_STUDIES', 'COMMERCIAL', 'COMPLIANCE', 'LEGAL', 'PRODUCTION', 'APPROVAL', 'SUBMISSION');
create type bid_task_type as enum ('RESEARCH', 'CONTENT', 'EVIDENCE', 'DESIGN', 'COMPLIANCE', 'APPROVAL', 'COMMERCIAL', 'SUBMISSION');
create type bid_task_status as enum ('TODO', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'DONE', 'CANCELLED');
create type bid_milestone_status as enum ('UPCOMING', 'IN_PROGRESS', 'AT_RISK', 'COMPLETED', 'MISSED');
create type bid_question_status as enum ('DRAFT', 'INTERNAL_REVIEW', 'READY_TO_SEND', 'SUBMITTED', 'ANSWERED', 'CLOSED');
create type bid_risk_status as enum ('OPEN', 'MITIGATING', 'RESOLVED', 'ACCEPTED');
create type bid_assumption_status as enum ('UNCONFIRMED', 'CONFIRMED', 'REJECTED');
-- Reuses the same 4-value severity vocabulary everywhere a deterministic,
-- rule-based (never "AI confidence") severity is needed (Phase 12 §16/§34).
create type bid_gap_severity as enum ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');
create type bid_source_type as enum ('TENDER_REQUIREMENT', 'EVALUATION_CRITERION', 'QUALIFICATION_RESULT', 'AGENCY_EVIDENCE', 'AGENCY_CAPABILITY', 'BID_DECISION', 'OPPORTUNITY_SCORE', 'CLOSING_DATE', 'BRIEFING', 'HUMAN_DEFINED');

-- ---------------------------------------------------------------
-- 1. Bid Project (Phase 12 §4/§6).
-- ---------------------------------------------------------------
create table bid_strategy_projects (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references tenders(id) on delete cascade,
  agency_id uuid not null references agencies(id) on delete cascade,
  project_name text not null,
  status bid_strategy_project_status not null default 'DRAFT',
  -- The exact Phase 11 decision run this project was created from
  -- (Phase 12 §5) — never null, a Bid Project cannot exist without a
  -- traceable decision (the create-gate enforces BID/authorised-REVIEW/
  -- human-overridden-to-BID before this row is ever written).
  bid_decision_run_id uuid not null references bid_decision_runs(id),
  current_strategy_version integer not null default 0,
  owner_user_id uuid references users(id),
  start_date date,
  target_submission_date date,
  actual_submission_date date,
  priority bid_strategy_priority not null default 'MEDIUM',
  bid_effort bid_effort_level not null default 'UNKNOWN',
  -- Snapshot only (Phase 12 §6/§20) — never a competing deadline or
  -- authoritative score; the canonical numbers always live on
  -- tenders.closing_date and tender_scoring_runs respectively.
  overall_score_snapshot numeric,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);
create index bid_strategy_projects_tender_id_idx on bid_strategy_projects (tender_id);
create index bid_strategy_projects_agency_id_idx on bid_strategy_projects (agency_id);
create index bid_strategy_projects_status_idx on bid_strategy_projects (status);
-- One active (non-cancelled/closed) Bid Project per tender+agency.
create unique index bid_strategy_projects_active_unique
  on bid_strategy_projects (tender_id, agency_id)
  where status not in ('CANCELLED', 'CLOSED');
create trigger bid_strategy_projects_set_updated_at
  before update on bid_strategy_projects
  for each row execute function set_updated_at();

create table bid_strategy_project_status_history (
  id uuid primary key default gen_random_uuid(),
  bid_project_id uuid not null references bid_strategy_projects(id) on delete cascade,
  from_status bid_strategy_project_status,
  to_status bid_strategy_project_status not null,
  changed_by uuid references users(id),
  changed_at timestamptz not null default now()
);
create index bid_strategy_project_status_history_project_id_idx on bid_strategy_project_status_history (bid_project_id);

-- ---------------------------------------------------------------
-- 2. Bid Strategy (Phase 12 §7/§26/§27) — versioned, narrative fields
--    only; every structured item lives in its own relational table
--    below (spec §7 binding instruction: no large uncontrolled JSON
--    blobs of structured items on this row).
-- ---------------------------------------------------------------
create table bid_strategies (
  id uuid primary key default gen_random_uuid(),
  bid_project_id uuid not null references bid_strategy_projects(id) on delete cascade,
  agency_id uuid not null references agencies(id) on delete cascade,
  version integer not null,
  status bid_strategy_status not null default 'DRAFT',
  objective text,
  strategy_summary text,
  response_strategy_summary text,
  evidence_strategy_summary text,
  production_strategy_summary text,
  risk_strategy_summary text,
  supersedes_strategy_id uuid references bid_strategies(id),
  is_current boolean not null default true,
  -- Same staleness mechanism as Phase 10/11 (Phase 12 §21): the
  -- structured input this version was generated from.
  input_snapshot jsonb not null default '{}'::jsonb,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_by uuid references users(id),
  approved_at timestamptz,
  constraint bid_strategies_project_version_unique unique (bid_project_id, version)
);
create index bid_strategies_bid_project_id_idx on bid_strategies (bid_project_id);
create index bid_strategies_agency_id_idx on bid_strategies (agency_id);
create unique index bid_strategies_current_unique on bid_strategies (bid_project_id) where is_current;
create trigger bid_strategies_set_updated_at
  before update on bid_strategies
  for each row execute function set_updated_at();

-- Phase 12 §26 (binding constraint): once APPROVED, a strategy row is
-- immutable — enforced at the DB level, not only application
-- discipline. Only is_current/is_stale-adjacent bookkeeping performed
-- by superseding (a new row) may ever transition an approved strategy
-- onward, never a mutation of the approved row's content.
create function prevent_approved_bid_strategy_mutation() returns trigger as $$
begin
  if old.status = 'APPROVED' then
    if new.status is distinct from old.status and new.status = 'SUPERSEDED' and new.is_current = false then
      return new; -- allowed: superseding on creation of the next version
    end if;
    raise exception 'bid_strategies: an APPROVED strategy version is immutable (id=%). Create a new version instead.', old.id;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger bid_strategies_prevent_approved_mutation
  before update on bid_strategies
  for each row execute function prevent_approved_bid_strategy_mutation();

-- Phase 12 §10/§11 — client/tender priorities extracted from Phase 9
-- data, never invented. One row per extracted or human-defined priority.
create table bid_strategy_priorities (
  id uuid primary key default gen_random_uuid(),
  bid_project_id uuid not null references bid_strategy_projects(id) on delete cascade,
  strategy_id uuid not null references bid_strategies(id) on delete cascade,
  priority_class bid_priority_class not null,
  title text not null,
  description text,
  source_type bid_source_type not null,
  source_id uuid,
  weight numeric,
  rank integer,
  created_at timestamptz not null default now()
);
create index bid_strategy_priorities_project_id_idx on bid_strategy_priorities (bid_project_id);
create index bid_strategy_priorities_strategy_id_idx on bid_strategy_priorities (strategy_id);

-- ---------------------------------------------------------------
-- 3. Win themes & differentiators (Phase 12 §8/§9).
-- ---------------------------------------------------------------
create table bid_win_themes (
  id uuid primary key default gen_random_uuid(),
  bid_project_id uuid not null references bid_strategy_projects(id) on delete cascade,
  strategy_id uuid not null references bid_strategies(id) on delete cascade,
  title text not null,
  description text,
  source_type bid_win_theme_source_type not null,
  source_id uuid,
  priority bid_gap_severity not null default 'MEDIUM',
  evidence_status bid_evidence_support_status not null default 'UNKNOWN',
  owner_user_id uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A win theme with no traceable source must be HUMAN_DEFINED — never
  -- silently attributed to tender data without a source_id (Phase 12 §8).
  constraint bid_win_themes_source_requires_id check (source_type = 'HUMAN_DEFINED' or source_id is not null)
);
create index bid_win_themes_project_id_idx on bid_win_themes (bid_project_id);
create index bid_win_themes_strategy_id_idx on bid_win_themes (strategy_id);
create trigger bid_win_themes_set_updated_at
  before update on bid_win_themes
  for each row execute function set_updated_at();

create table bid_differentiators (
  id uuid primary key default gen_random_uuid(),
  bid_project_id uuid not null references bid_strategy_projects(id) on delete cascade,
  strategy_id uuid not null references bid_strategies(id) on delete cascade,
  title text not null,
  description text,
  evidence_status bid_evidence_support_status not null default 'EVIDENCE_REQUIRED',
  supporting_evidence_count integer not null default 0,
  priority bid_gap_severity not null default 'MEDIUM',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Phase 12 §9 (binding constraint): the system can never represent
  -- an unsupported claim as SUPPORTED — SUPPORTED/PARTIALLY_SUPPORTED
  -- require at least one counted piece of evidence.
  constraint bid_differentiators_supported_requires_evidence check (
    evidence_status not in ('SUPPORTED', 'PARTIALLY_SUPPORTED') or supporting_evidence_count > 0
  )
);
create index bid_differentiators_project_id_idx on bid_differentiators (bid_project_id);
create index bid_differentiators_strategy_id_idx on bid_differentiators (strategy_id);
create trigger bid_differentiators_set_updated_at
  before update on bid_differentiators
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------
-- 4. Evaluation strategy (Phase 12 §12) — one row per meaningful
--    Phase 9 evaluation criterion, per strategy version.
-- ---------------------------------------------------------------
create table bid_evaluation_strategies (
  id uuid primary key default gen_random_uuid(),
  bid_project_id uuid not null references bid_strategy_projects(id) on delete cascade,
  strategy_id uuid not null references bid_strategies(id) on delete cascade,
  evaluation_criterion_id uuid not null references tender_evaluation_criteria(id),
  strategy text,
  response_objective text,
  priority bid_gap_severity not null default 'MEDIUM',
  evidence_required boolean not null default false,
  evidence_status bid_evidence_support_status not null default 'UNKNOWN',
  owner_user_id uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bid_evaluation_strategies_unique unique (strategy_id, evaluation_criterion_id)
);
create index bid_evaluation_strategies_project_id_idx on bid_evaluation_strategies (bid_project_id);
create index bid_evaluation_strategies_criterion_id_idx on bid_evaluation_strategies (evaluation_criterion_id);
create trigger bid_evaluation_strategies_set_updated_at
  before update on bid_evaluation_strategies
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------
-- 5. Requirement response plan (Phase 12 §13/§14) — planning only,
--    never duplicating tender_requirements itself.
-- ---------------------------------------------------------------
create table bid_requirement_plans (
  id uuid primary key default gen_random_uuid(),
  bid_project_id uuid not null references bid_strategy_projects(id) on delete cascade,
  strategy_id uuid not null references bid_strategies(id) on delete cascade,
  tender_requirement_id uuid not null references tender_requirements(id),
  response_type bid_requirement_response_type not null default 'REQUIRES_HUMAN_REVIEW',
  response_status bid_requirement_response_status not null default 'NOT_STARTED',
  response_owner uuid references users(id),
  evidence_required boolean not null default false,
  evidence_status bid_evidence_support_status not null default 'UNKNOWN',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bid_requirement_plans_unique unique (strategy_id, tender_requirement_id)
);
create index bid_requirement_plans_project_id_idx on bid_requirement_plans (bid_project_id);
create index bid_requirement_plans_requirement_id_idx on bid_requirement_plans (tender_requirement_id);
create trigger bid_requirement_plans_set_updated_at
  before update on bid_requirement_plans
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------
-- 6. Evidence needs (Phase 12 §15/§16) — REQUESTS only, never
--    automatic matching/selection (that is Phase 13).
-- ---------------------------------------------------------------
create table bid_evidence_needs (
  id uuid primary key default gen_random_uuid(),
  bid_project_id uuid not null references bid_strategy_projects(id) on delete cascade,
  strategy_id uuid references bid_strategies(id) on delete cascade,
  source_type bid_source_type not null,
  source_id uuid,
  requirement_id uuid references tender_requirements(id),
  evaluation_criterion_id uuid references tender_evaluation_criteria(id),
  description text not null,
  minimum_count integer not null default 1,
  current_count integer not null default 0,
  status bid_evidence_need_status not null default 'OPEN',
  severity bid_gap_severity not null default 'MEDIUM',
  owner_user_id uuid references users(id),
  due_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index bid_evidence_needs_project_id_idx on bid_evidence_needs (bid_project_id);
create index bid_evidence_needs_status_idx on bid_evidence_needs (status);
create trigger bid_evidence_needs_set_updated_at
  before update on bid_evidence_needs
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------
-- 7. Workstreams, tasks, milestones (Phase 12 §17-§19).
-- ---------------------------------------------------------------
create table bid_workstreams (
  id uuid primary key default gen_random_uuid(),
  bid_project_id uuid not null references bid_strategy_projects(id) on delete cascade,
  category bid_workstream_category not null,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bid_workstreams_project_category_unique unique (bid_project_id, category)
);
create index bid_workstreams_project_id_idx on bid_workstreams (bid_project_id);
create trigger bid_workstreams_set_updated_at
  before update on bid_workstreams
  for each row execute function set_updated_at();

create table bid_tasks (
  id uuid primary key default gen_random_uuid(),
  bid_project_id uuid not null references bid_strategy_projects(id) on delete cascade,
  workstream_id uuid references bid_workstreams(id),
  title text not null,
  description text,
  task_type bid_task_type not null,
  owner_user_id uuid references users(id),
  status bid_task_status not null default 'TODO',
  priority bid_gap_severity not null default 'MEDIUM',
  due_date date,
  dependency_task_id uuid references bid_tasks(id),
  source_type bid_source_type,
  source_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index bid_tasks_project_id_idx on bid_tasks (bid_project_id);
create index bid_tasks_workstream_id_idx on bid_tasks (workstream_id);
create index bid_tasks_status_idx on bid_tasks (status);
create trigger bid_tasks_set_updated_at
  before update on bid_tasks
  for each row execute function set_updated_at();

create table bid_milestones (
  id uuid primary key default gen_random_uuid(),
  bid_project_id uuid not null references bid_strategy_projects(id) on delete cascade,
  name text not null,
  description text,
  due_date date,
  status bid_milestone_status not null default 'UPCOMING',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index bid_milestones_project_id_idx on bid_milestones (bid_project_id);
create trigger bid_milestones_set_updated_at
  before update on bid_milestones
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------
-- 8. Questions, risks, assumptions (Phase 12 §29/§34/§35).
-- ---------------------------------------------------------------
create table bid_questions (
  id uuid primary key default gen_random_uuid(),
  bid_project_id uuid not null references bid_strategy_projects(id) on delete cascade,
  question text not null,
  context text,
  source_requirement_id uuid references tender_requirements(id),
  source_evaluation_criterion_id uuid references tender_evaluation_criteria(id),
  status bid_question_status not null default 'DRAFT',
  assigned_to uuid references users(id),
  due_date date,
  answer text,
  answer_source text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Phase 12 §29 (binding constraint): the system never invents an
  -- answer — an answer, when present, must always be attributable.
  constraint bid_questions_answer_requires_source check (answer is null or answer_source is not null)
);
create index bid_questions_project_id_idx on bid_questions (bid_project_id);
create trigger bid_questions_set_updated_at
  before update on bid_questions
  for each row execute function set_updated_at();

create table bid_risks (
  id uuid primary key default gen_random_uuid(),
  bid_project_id uuid not null references bid_strategy_projects(id) on delete cascade,
  title text not null,
  description text,
  severity bid_gap_severity not null default 'MEDIUM',
  status bid_risk_status not null default 'OPEN',
  source_type bid_source_type not null,
  source_id uuid,
  mitigation text,
  owner_user_id uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index bid_risks_project_id_idx on bid_risks (bid_project_id);
create trigger bid_risks_set_updated_at
  before update on bid_risks
  for each row execute function set_updated_at();

create table bid_assumptions (
  id uuid primary key default gen_random_uuid(),
  bid_project_id uuid not null references bid_strategy_projects(id) on delete cascade,
  statement text not null,
  source_type bid_source_type not null,
  source_id uuid,
  status bid_assumption_status not null default 'UNCONFIRMED',
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index bid_assumptions_project_id_idx on bid_assumptions (bid_project_id);
create trigger bid_assumptions_set_updated_at
  before update on bid_assumptions
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------
-- 9. Readiness snapshots (Phase 12 §22/§23) — one row per
--    recalculation, append-only, so readiness history is auditable
--    (BID_READINESS_RECALCULATED, Phase 12 §39).
-- ---------------------------------------------------------------
create table bid_readiness_snapshots (
  id uuid primary key default gen_random_uuid(),
  bid_project_id uuid not null references bid_strategy_projects(id) on delete cascade,
  status text not null,
  blockers jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  completed_items jsonb not null default '[]'::jsonb,
  outstanding_items jsonb not null default '[]'::jsonb,
  completeness jsonb not null default '{}'::jsonb,
  calculated_at timestamptz not null default now()
);
create index bid_readiness_snapshots_project_id_idx on bid_readiness_snapshots (bid_project_id);

-- ---------------------------------------------------------------
-- RLS — every agency-owned table: authenticated read-only via a join
-- back to bid_strategy_projects.agency_id (or directly where the
-- table itself carries agency_id), service-role-only mutation. Same
-- exact convention as Phase 8/10/11.
-- ---------------------------------------------------------------
alter table bid_strategy_projects enable row level security;
create policy bid_strategy_projects_select_own_agency on bid_strategy_projects
  for select to authenticated using (agency_id = current_agency_id());

alter table bid_strategy_project_status_history enable row level security;
create policy bid_strategy_project_status_history_select_own_agency on bid_strategy_project_status_history
  for select to authenticated using (
    exists (select 1 from bid_strategy_projects p where p.id = bid_strategy_project_status_history.bid_project_id and p.agency_id = current_agency_id())
  );

alter table bid_strategies enable row level security;
create policy bid_strategies_select_own_agency on bid_strategies
  for select to authenticated using (agency_id = current_agency_id());

alter table bid_strategy_priorities enable row level security;
create policy bid_strategy_priorities_select_own_agency on bid_strategy_priorities
  for select to authenticated using (
    exists (select 1 from bid_strategy_projects p where p.id = bid_strategy_priorities.bid_project_id and p.agency_id = current_agency_id())
  );

alter table bid_win_themes enable row level security;
create policy bid_win_themes_select_own_agency on bid_win_themes
  for select to authenticated using (
    exists (select 1 from bid_strategy_projects p where p.id = bid_win_themes.bid_project_id and p.agency_id = current_agency_id())
  );

alter table bid_differentiators enable row level security;
create policy bid_differentiators_select_own_agency on bid_differentiators
  for select to authenticated using (
    exists (select 1 from bid_strategy_projects p where p.id = bid_differentiators.bid_project_id and p.agency_id = current_agency_id())
  );

alter table bid_evaluation_strategies enable row level security;
create policy bid_evaluation_strategies_select_own_agency on bid_evaluation_strategies
  for select to authenticated using (
    exists (select 1 from bid_strategy_projects p where p.id = bid_evaluation_strategies.bid_project_id and p.agency_id = current_agency_id())
  );

alter table bid_requirement_plans enable row level security;
create policy bid_requirement_plans_select_own_agency on bid_requirement_plans
  for select to authenticated using (
    exists (select 1 from bid_strategy_projects p where p.id = bid_requirement_plans.bid_project_id and p.agency_id = current_agency_id())
  );

alter table bid_evidence_needs enable row level security;
create policy bid_evidence_needs_select_own_agency on bid_evidence_needs
  for select to authenticated using (
    exists (select 1 from bid_strategy_projects p where p.id = bid_evidence_needs.bid_project_id and p.agency_id = current_agency_id())
  );

alter table bid_workstreams enable row level security;
create policy bid_workstreams_select_own_agency on bid_workstreams
  for select to authenticated using (
    exists (select 1 from bid_strategy_projects p where p.id = bid_workstreams.bid_project_id and p.agency_id = current_agency_id())
  );

alter table bid_tasks enable row level security;
create policy bid_tasks_select_own_agency on bid_tasks
  for select to authenticated using (
    exists (select 1 from bid_strategy_projects p where p.id = bid_tasks.bid_project_id and p.agency_id = current_agency_id())
  );

alter table bid_milestones enable row level security;
create policy bid_milestones_select_own_agency on bid_milestones
  for select to authenticated using (
    exists (select 1 from bid_strategy_projects p where p.id = bid_milestones.bid_project_id and p.agency_id = current_agency_id())
  );

alter table bid_questions enable row level security;
create policy bid_questions_select_own_agency on bid_questions
  for select to authenticated using (
    exists (select 1 from bid_strategy_projects p where p.id = bid_questions.bid_project_id and p.agency_id = current_agency_id())
  );

alter table bid_risks enable row level security;
create policy bid_risks_select_own_agency on bid_risks
  for select to authenticated using (
    exists (select 1 from bid_strategy_projects p where p.id = bid_risks.bid_project_id and p.agency_id = current_agency_id())
  );

alter table bid_assumptions enable row level security;
create policy bid_assumptions_select_own_agency on bid_assumptions
  for select to authenticated using (
    exists (select 1 from bid_strategy_projects p where p.id = bid_assumptions.bid_project_id and p.agency_id = current_agency_id())
  );

alter table bid_readiness_snapshots enable row level security;
create policy bid_readiness_snapshots_select_own_agency on bid_readiness_snapshots
  for select to authenticated using (
    exists (select 1 from bid_strategy_projects p where p.id = bid_readiness_snapshots.bid_project_id and p.agency_id = current_agency_id())
  );

-- No authenticated insert/update/delete policy anywhere in this
-- migration — service-role only, same convention as every prior
-- phase. All writes go through apps/api/src/lib/bidStrategy/* and
-- apps/api/src/routes/bidStrategy.ts using the privileged client,
-- which enforces role gating and business rules (project-creation
-- gate, approval blockers, immutability) before ever reaching these
-- tables.
