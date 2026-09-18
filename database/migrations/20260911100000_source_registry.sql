-- Phase 4: the Tender Source Registry's operational layer — adapter
-- state, scan history, and structured error tracking — built on top
-- of the Phase 2 `tender_sources` table rather than duplicating it
-- (Phase 4 §3: "Use the existing tender_sources table... Review the
-- existing schema before modifying it. Do not create duplicate
-- tables."). This migration is additive only: every Phase 2 column
-- tender_sources already had (scan_frequency, requires_login,
-- supports_documents, last_scan_at/last_success_at/last_failure_at,
-- error_count, health_status, notes, active) is untouched.

-- ---------------------------------------------------------------
-- New enums (Phase 4 §7/§9/§10).
-- ---------------------------------------------------------------

-- The operational state of a source's ADAPTER — distinct from
-- `source_health` (which reflects observed reliability). A source can
-- only ever be ACTIVE if a real adapter is registered for it in code
-- (apps/api/src/lib/adapters/registry.ts) — the database alone never
-- implies a source is "active simply because a row exists" (Phase 4
-- §7). NOT_IMPLEMENTED is the default for every source until a real
-- adapter exists (Phase 5+).
create type adapter_state as enum (
  'NOT_IMPLEMENTED', 'CONFIGURED', 'ACTIVE', 'PAUSED', 'FAILED', 'DISABLED'
);

create type source_scan_status as enum (
  'QUEUED', 'RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED', 'CANCELLED'
);

create type source_error_type as enum (
  'NETWORK', 'TIMEOUT', 'HTTP', 'AUTHENTICATION', 'RATE_LIMIT',
  'PARSING', 'DOCUMENT', 'VALIDATION', 'UNKNOWN'
);

-- ---------------------------------------------------------------
-- tender_sources: minimal additive columns (Phase 4 §3/§6/§7).
-- ---------------------------------------------------------------

alter table tender_sources
  -- The code-level adapter registry key (apps/api/src/lib/adapters)
  -- that implements this source, e.g. 'etenders'. Null means exactly
  -- what Phase 4 §5/§20 require the UI to say plainly: NOT CONNECTED
  -- — no adapter exists yet, never inferred from the source merely
  -- existing in this table.
  add column adapter_key text,
  add column adapter_state adapter_state not null default 'NOT_IMPLEMENTED',
  -- When an ADMIN paused this source's adapter (Phase 4 §17); cleared
  -- on resume. Purely informational (surfaced in the UI as "paused
  -- since ..."), not used in any scheduling calculation.
  add column paused_at timestamptz;

comment on column tender_sources.adapter_key is
  'Code-level adapter registry key. Null = no adapter implemented yet (NOT CONNECTED, Phase 4 §5).';
comment on column tender_sources.adapter_state is
  'Operational state of the adapter for this source (Phase 4 §7). Independent of health_status.';

-- `next_scheduled_scan_at` is deliberately NOT a stored column — it is
-- always derivable as `last_scan_at + scan_frequency` (or "now" if
-- never scanned and an adapter is active), and computing it in the
-- API layer (apps/api/src/lib/sourceSchedule.ts) avoids a second
-- place this can drift out of sync with `last_scan_at`/`scan_frequency`
-- themselves (Phase 4 §12: prepare the architecture, don't introduce
-- redundant state).

-- ---------------------------------------------------------------
-- tender_source_scans (Phase 4 §9). One row per scan/run attempt —
-- this is the operational history that will later back the BullMQ
-- job queue's run records (Phase 5+), never scraped or fabricated
-- here (Phase 4 §25: no live scraping yet, so this table is created
-- empty and stays empty until Phase 5).
-- ---------------------------------------------------------------
create table tender_source_scans (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references tender_sources(id) on delete cascade,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status source_scan_status not null default 'QUEUED',
  records_discovered integer not null default 0,
  records_processed integer not null default 0,
  records_failed integer not null default 0,
  documents_discovered integer not null default 0,
  error_count integer not null default 0,
  error_message text,
  -- Correlates this scan row with the job/run that produced it (e.g.
  -- a BullMQ job id) once Phase 5+ wires real scheduling — a plain
  -- text id, not a foreign key, since the job system is external to
  -- this schema.
  execution_id text,
  adapter_version text,
  created_at timestamptz not null default now(),
  constraint tender_source_scans_counts_non_negative check (
    records_discovered >= 0 and records_processed >= 0 and records_failed >= 0
    and documents_discovered >= 0 and error_count >= 0
  ),
  constraint tender_source_scans_completed_after_started check (
    completed_at is null or completed_at >= started_at
  )
);

create index tender_source_scans_source_id_idx on tender_source_scans (source_id, started_at desc);
create index tender_source_scans_status_idx on tender_source_scans (status);

-- ---------------------------------------------------------------
-- tender_source_errors (Phase 4 §10). Structured, queryable error
-- tracking per source (and optionally per scan) — deliberately no
-- column that could ever hold a credential or secret (Phase 4 §10:
-- "Do not store secrets or credentials"; `metadata` is free-form
-- jsonb for non-sensitive diagnostic context only, e.g. a response
-- header name or a parser rule id, never a token or password).
-- ---------------------------------------------------------------
create table tender_source_errors (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references tender_sources(id) on delete cascade,
  scan_id uuid references tender_source_scans(id) on delete set null,
  error_type source_error_type not null,
  severity severity not null default 'MEDIUM',
  message text not null,
  url text,
  status_code integer,
  retryable boolean not null default false,
  occurred_at timestamptz not null default now(),
  resolved_at timestamptz,
  metadata jsonb,
  constraint tender_source_errors_resolved_after_occurred check (
    resolved_at is null or resolved_at >= occurred_at
  )
);

create index tender_source_errors_source_id_idx on tender_source_errors (source_id, occurred_at desc);
create index tender_source_errors_scan_id_idx on tender_source_errors (scan_id);
create index tender_source_errors_unresolved_idx on tender_source_errors (source_id) where resolved_at is null;

-- ---------------------------------------------------------------
-- RLS (Phase 4 §18/§26 — "do not weaken existing RLS"). Both new
-- tables follow the exact same shape as every other shared-catalogue
-- table (docs/DATABASE.md §5, 20260910200180_rls_policies.sql):
-- readable by any authenticated user (scan history and error history
-- are operational transparency, not agency-private data — Phase 4
-- §18 grants BID_MANAGER/RESEARCHER read access alongside ADMIN, and
-- there is no per-agency scoping concept for a global source), and
-- writable only by the privileged server-side service role, which
-- bypasses RLS — never directly by a browser client. The API layer
-- (apps/api/src/lib/requireRole.ts) is what restricts the
-- enable/disable/pause/resume/health-check ADMIN actions; RLS is the
-- second, independent enforcement layer against a compromised or
-- buggy frontend.
-- ---------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['tender_source_scans', 'tender_source_errors']
  loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy %I on %I for select to authenticated using (true)',
      t || '_select_authenticated', t
    );
  end loop;
end $$;
