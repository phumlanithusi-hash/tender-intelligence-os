-- Phase 20 — Enterprise Hardening, Continuous Surveillance & System
-- Convergence.
--
-- Per this project's established convention (Phase 19's migration
-- comment, itself following the same rule from earlier phases): "if
-- the repository has already implemented any proposed capability,
-- reuse and extend it rather than creating a duplicate architecture."
-- The spec's literal §5 table list (`tender_addenda`,
-- `bid_addenda_acknowledgements`, `audit_trail_events`,
-- `industry_benchmarks_daily`) is reconciled against what already
-- exists as follows (documented in full in docs/DECISIONS.md):
--
--  1. `tender_addenda` (Phase 2 §9) already exists — this migration
--     EXTENDS it (content_hash, impact_assessment, detected_via)
--     rather than recreating it, and relaxes `document_id` to
--     nullable so the new diff-engine detection path (spec §4A) can
--     create an addendum with no distinct new source document.
--  2. `bid_addenda_acknowledgements` (spec's literal plural name) is
--     NOT created as a second table — Phase 19 already built the
--     functionally-identical `bid_addendum_acknowledgements`
--     (singular "addendum") with the exact fields spec §5 asks for
--     (FK to bid_projects [via bid_strategy_projects], FK to
--     tender_addenda, acknowledged_by, timestamp) plus a `reconciled`
--     distinction spec §5 does not even ask for. Building a second,
--     differently-named table here would fork the acknowledgement
--     truth in two places for no functional gain — left untouched.
--  3. `audit_trail_events` and `industry_benchmarks_daily` are
--     genuinely new (spec §4C/§4D) and are created below exactly as
--     named.

-- ---------------------------------------------------------------
-- 1. tender_addenda extension (spec §4A/§5)
-- ---------------------------------------------------------------
alter table tender_addenda alter column document_id drop not null;

alter table tender_addenda
  add column content_hash text,
  add column impact_assessment jsonb not null default '{}'::jsonb,
  add column detected_via text not null default 'DOCUMENT';

alter table tender_addenda
  add constraint tender_addenda_detected_via_valid
    check (detected_via in ('DOCUMENT', 'DIFF_ENGINE'));

-- The original Phase 2 §9 DOCUMENT path still requires a document;
-- only a DIFF_ENGINE-detected structural change may omit one.
alter table tender_addenda
  add constraint tender_addenda_document_required_for_document_path
    check (detected_via <> 'DOCUMENT' or document_id is not null);

create index tender_addenda_detected_via_idx on tender_addenda (detected_via);

-- ---------------------------------------------------------------
-- 2. audit_trail_events (spec §4D/§5) — unified, append-only,
--    cross-stage chain-of-custody records. `correlation_id` is
--    whatever entity ties one lineage chain together end to end (in
--    practice: a bid_strategy_projects.id for the bid-side stages, or
--    a tenders.id for the source-side stages before a bid project
--    exists) — never a foreign key to one single table, since the
--    whole point is correlating across several different entity
--    types over time (spec §4D: "Source Scan → Tender Import →
--    Requirement Extraction → Strategy Generation → Evidence Match →
--    Human Signoff → Submission").
-- ---------------------------------------------------------------
create table audit_trail_events (
  id uuid primary key default gen_random_uuid(),
  correlation_id uuid not null,
  -- Nullable for the same reason audit_logs.agency_id is nullable
  -- (source-side stages before any agency has a bid project against
  -- the tender are not agency-scoped facts).
  agency_id uuid references agencies(id),
  stage text not null,
  entity_type text not null,
  entity_id uuid,
  actor_type actor_type not null default 'SYSTEM',
  actor_id uuid,
  agent_name text,
  summary text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint audit_trail_events_stage_valid check (stage in (
    'SOURCE_SCAN', 'TENDER_IMPORT', 'REQUIREMENT_EXTRACTION', 'STRATEGY_GENERATION',
    'EVIDENCE_MATCH', 'HUMAN_SIGNOFF', 'SUBMISSION', 'ADDENDUM_DETECTED',
    'ADDENDUM_ACKNOWLEDGED', 'OUTCOME_RECORDED'
  )),
  constraint audit_trail_events_agent_name_required_for_agent
    check (actor_type <> 'AGENT' or agent_name is not null)
);

create index audit_trail_events_correlation_idx on audit_trail_events (correlation_id, created_at);
create index audit_trail_events_entity_idx on audit_trail_events (entity_type, entity_id);
create index audit_trail_events_agency_idx on audit_trail_events (agency_id) where agency_id is not null;
create index audit_trail_events_stage_idx on audit_trail_events (stage);

-- Append-only (mirrors prevent_addendum_acknowledgement_mutation
-- exactly): a chain-of-custody record must never be edited after the
-- fact, or it stops being a trustworthy audit trail.
create function prevent_audit_trail_event_mutation() returns trigger as $$
begin
  raise exception 'audit_trail_events: row % is immutable once recorded.', old.id;
end;
$$ language plpgsql;
create trigger audit_trail_events_prevent_mutation
  before update on audit_trail_events
  for each row execute function prevent_audit_trail_event_mutation();
create trigger audit_trail_events_prevent_delete
  before delete on audit_trail_events
  for each row execute function prevent_audit_trail_event_mutation();

alter table audit_trail_events enable row level security;
-- Visible to ADMIN users of the entry's own agency, plus any
-- agency-null (system-wide/source-side) entries — same visibility
-- rule as audit_logs (docs/SECURITY.md §9), since this is at least as
-- sensitive a cross-entity view.
create policy audit_trail_events_select_admin_own_agency on audit_trail_events
  for select to authenticated
  using (
    (agency_id is null or agency_id = current_agency_id())
    and exists (select 1 from users u where u.id = auth.uid() and u.role = 'ADMIN')
  );
-- No insert/update/delete policy for `authenticated` — written
-- exclusively by the privileged service-role client.

-- ---------------------------------------------------------------
-- 3. industry_benchmarks_daily (spec §4C/§5) — materialized,
--    anonymized cross-agency benchmark metrics. Never carries an
--    agency_id or any per-bid identifying value; a group below the
--    k-anonymity floor (>= 5 distinct entities, spec §3 binding
--    constraint) must never be inserted with real statistics — the
--    CHECK constraint below is DB-level defense in depth on top of
--    the application-level enforcement in
--    lib/benchmarks/aggregate.ts.
-- ---------------------------------------------------------------
create table industry_benchmarks_daily (
  id uuid primary key default gen_random_uuid(),
  metric_date date not null,
  category text,
  region text,
  metric_type text not null,
  sample_size integer not null,
  p25 numeric,
  p50 numeric,
  p75 numeric,
  mean numeric,
  stddev numeric,
  computed_at timestamptz not null default now(),
  constraint industry_benchmarks_daily_metric_type_valid
    check (metric_type in ('CYCLE_DAYS', 'PRICE_VARIANCE', 'VOLUME')),
  constraint industry_benchmarks_daily_sample_size_non_negative check (sample_size >= 0),
  -- k-anonymity floor: a row asserting real statistics (any non-null
  -- percentile/mean/stddev) must have cleared sample_size >= 5. A row
  -- BELOW the floor may still exist (so the UI can render
  -- "INSUFFICIENT_BENCHMARK_DATA" with an honest sample_size rather
  -- than nothing at all) but only with every statistic null.
  constraint industry_benchmarks_daily_k_anonymity
    check (sample_size >= 5 or (p25 is null and p50 is null and p75 is null and mean is null and stddev is null)),
  constraint industry_benchmarks_daily_unique unique (metric_date, category, region, metric_type)
);

create index industry_benchmarks_daily_lookup_idx on industry_benchmarks_daily (category, region, metric_type);
create index industry_benchmarks_daily_date_idx on industry_benchmarks_daily (metric_date desc);

alter table industry_benchmarks_daily enable row level security;
-- Fully anonymized, cross-agency data by design (spec §4C) — readable
-- by any authenticated user, exactly like the other shared/catalogue
-- tables (docs/SECURITY.md §3). No agency scoping applies because no
-- agency-identifying data exists on this table at all.
create policy industry_benchmarks_daily_select_authenticated on industry_benchmarks_daily
  for select to authenticated using (true);
-- No insert/update/delete policy for `authenticated` — recomputed
-- exclusively by the privileged service-role client
-- (POST /api/intelligence/benchmarks/recompute, ADMIN-only).

-- ---------------------------------------------------------------
-- 4. Phase 20 audit event vocabulary written into the existing
--    free-text audit_logs.action exactly as prior phases do:
--    ADDENDUM_DETECTED_BY_DIFF_ENGINE, SURVEILLANCE_SCAN_RUN,
--    BENCHMARK_RECOMPUTED.
-- ---------------------------------------------------------------
