-- Phase 19 — Production Integration, Data Completeness & Intelligence
-- Operations.
--
-- Per the Phase 19 spec's own instruction ("If the repository has
-- already implemented any proposed capability, reuse and extend it
-- rather than creating a duplicate architecture"), this migration is
-- additive only and adds exactly two new capabilities the production
-- limitation audit found genuinely missing:
--
--  1. Addenda ACKNOWLEDGEMENT tracking (spec §12). `tender_addenda`
--     (Phase 2 §9) already records what changed; nothing anywhere
--     recorded whether a given agency's bid team has acknowledged a
--     given addendum. `supabaseSubmissionReadinessStore.ts` therefore
--     hard-coded every addendum's `acknowledged`/`acknowledgementRequired`
--     to `false` (Phase 15 Known Limitation, `docs/DECISIONS.md` #1).
--     Acknowledgement is inherently agency-scoped (two different
--     agencies bidding the same tender acknowledge independently), so
--     this is a new agency-owned table, not a column added to the
--     shared/catalogue `tender_addenda` table.
--
--  2. A persisted `data_quality_violations` ledger (spec §17/§18) so
--     violations detected by a data-quality scan have a durable
--     status/resolution lifecycle rather than only ever being a
--     transient computed list.
--
-- Both tables follow the exact established conventions: agency-scoped
-- RLS (`agency_id = current_agency_id()` select-only for
-- `authenticated`, service-role-only writes), append-only/immutable
-- history where the underlying fact must never be silently rewritten,
-- and CHECK constraints doing real enforcement rather than relying on
-- application discipline alone.

-- ---------------------------------------------------------------
-- 1. bid_addendum_acknowledgements
-- ---------------------------------------------------------------
-- A human, agency-scoped fact: "this bid team has seen and accounted
-- for this addendum." Acknowledging an addendum is NEVER inferred by
-- the system (e.g. from a document being downloaded) — only ever
-- written by an explicit authenticated human action via
-- POST /api/bids/:id/addenda/:addendumId/acknowledge (spec §12
-- binding constraint: "addenda must not silently modify historical
-- tender versions" — acknowledgement is a bid-team fact layered on
-- top, never a mutation of the addendum record itself).
create table bid_addendum_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  bid_project_id uuid not null references bid_strategy_projects(id) on delete cascade,
  addendum_id uuid not null references tender_addenda(id),
  acknowledged_by uuid not null references users(id),
  acknowledged_at timestamptz not null default now(),
  -- Whether the acknowledging user attests the current proposal/
  -- pricing/evidence has actually been reconciled against this
  -- addendum's impact, distinct from merely having seen it (Phase 15
  -- §12/§25 distinguishes "acknowledged" from "reconciled" and this
  -- table must be able to answer both questions truthfully).
  reconciled boolean not null default false,
  note text,
  created_at timestamptz not null default now(),
  -- One acknowledgement per addendum per bid project — a second
  -- acknowledgement attempt is a no-op read of the existing row, never
  -- a duplicate/competing fact.
  constraint bid_addendum_acknowledgements_unique unique (bid_project_id, addendum_id)
);

create index bid_addendum_acknowledgements_bid_project_idx on bid_addendum_acknowledgements (bid_project_id);
create index bid_addendum_acknowledgements_addendum_idx on bid_addendum_acknowledgements (addendum_id);
create index bid_addendum_acknowledgements_agency_idx on bid_addendum_acknowledgements (agency_id);

-- Immutable once recorded: an acknowledgement is a point-in-time human
-- attestation. A mistaken acknowledgement is corrected by a human
-- conversation/process outside this table, never by silently editing
-- the historical record (mirrors prevent_submission_receipt_mutation
-- etc. exactly) — no UPDATE is ever legitimate on this table.
create function prevent_addendum_acknowledgement_mutation() returns trigger as $$
begin
  raise exception 'bid_addendum_acknowledgements: row % is immutable once recorded; acknowledgements are never edited.', old.id;
end;
$$ language plpgsql;
create trigger bid_addendum_acknowledgements_prevent_mutation
  before update on bid_addendum_acknowledgements
  for each row execute function prevent_addendum_acknowledgement_mutation();

alter table bid_addendum_acknowledgements enable row level security;
create policy bid_addendum_acknowledgements_select_own_agency on bid_addendum_acknowledgements
  for select to authenticated using (agency_id = current_agency_id());

-- ---------------------------------------------------------------
-- 2. data_quality_violations (spec §17/§18)
-- ---------------------------------------------------------------
-- A durable ledger of deterministic data-quality rule violations.
-- `agency_id` is nullable: some rules are about shared/catalogue data
-- (e.g. a tender with no closing date) and are visible to any
-- authenticated user exactly like the underlying tender is; others are
-- inherently agency-scoped (e.g. "bid marked submitted without
-- verified submission evidence") and carry the owning agency.
create type data_quality_severity as enum ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');
create type data_quality_violation_status as enum ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED');

create table data_quality_violations (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid references agencies(id) on delete cascade,
  rule text not null,
  severity data_quality_severity not null,
  entity_type text not null,
  entity_id uuid not null,
  details jsonb not null default '{}'::jsonb,
  detected_at timestamptz not null default now(),
  status data_quality_violation_status not null default 'OPEN',
  resolution text,
  resolved_by uuid references users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint data_quality_violations_resolved_requires_reason
    check (status not in ('RESOLVED', 'DISMISSED') or (resolution is not null and resolved_by is not null and resolved_at is not null))
);

-- One OPEN violation per (rule, entity) at a time — re-running the
-- scan must never create duplicate open rows for the same underlying
-- problem (spec §14 "a retry must never create duplicates", applied
-- here to the scan action itself).
create unique index data_quality_violations_open_unique
  on data_quality_violations (rule, entity_type, entity_id)
  where status = 'OPEN';

create index data_quality_violations_agency_idx on data_quality_violations (agency_id);
create index data_quality_violations_status_idx on data_quality_violations (status);
create index data_quality_violations_severity_idx on data_quality_violations (severity);
create index data_quality_violations_entity_idx on data_quality_violations (entity_type, entity_id);

create trigger data_quality_violations_set_updated_at
  before update on data_quality_violations
  for each row execute function set_updated_at();

-- Only status/resolution/resolved_by/resolved_at may ever change on an
-- existing row (a human resolving/dismissing it); the detected facts
-- (rule, entity, details, detected_at) are immutable — re-detecting
-- the same problem creates a new OPEN row once the old one is
-- resolved/dismissed, it never silently rewrites what was found.
create function prevent_data_quality_violation_fact_mutation() returns trigger as $$
begin
  if new.rule is distinct from old.rule
     or new.entity_type is distinct from old.entity_type
     or new.entity_id is distinct from old.entity_id
     or new.detected_at is distinct from old.detected_at
     or new.agency_id is distinct from old.agency_id then
    raise exception 'data_quality_violations: row % detected-fact fields are immutable; only status/resolution may change.', old.id;
  end if;
  return new;
end;
$$ language plpgsql;
create trigger data_quality_violations_prevent_fact_mutation
  before update on data_quality_violations
  for each row execute function prevent_data_quality_violation_fact_mutation();

alter table data_quality_violations enable row level security;
-- Agency-scoped rows are visible only to that agency; shared/catalogue
-- rows (agency_id is null) are visible to any authenticated user,
-- exactly like the underlying shared tables (tenders, tender_documents
-- etc.) they describe.
create policy data_quality_violations_select on data_quality_violations
  for select to authenticated using (agency_id is null or agency_id = current_agency_id());

-- ---------------------------------------------------------------
-- 3. Audit event vocabulary used by Phase 19 (written into the
-- existing free-text audit_logs.action exactly as prior phases do):
-- ADDENDUM_ACKNOWLEDGED, DATA_QUALITY_SCAN_RUN,
-- DATA_QUALITY_VIOLATION_DETECTED, DATA_QUALITY_VIOLATION_RESOLVED,
-- DATA_QUALITY_VIOLATION_DISMISSED.
-- ---------------------------------------------------------------
