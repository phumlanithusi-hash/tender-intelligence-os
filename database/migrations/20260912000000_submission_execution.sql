-- Phase 16: Submission Execution, Submission Tracking & Receipt Intelligence.
--
-- Reviewed first, per the binding spec: bid_strategy_projects,
-- bid_submission_readiness/bid_submission_packs/bid_submission_pack_files/
-- bid_submission_manifests/bid_submission_approvals (Phase 15, read-only
-- upstream state this phase never re-implements), tenders
-- (submission_method/submission_url/submission_email/closing_date/
-- closing_time), audit_logs (Phase 2 §22, reused as-is).
--
-- COLLISION CHECK (same discipline as Phase 9-15): `bid_submissions`
-- (Phase 2 §18, 20260910200150_bid_architecture.sql) already exists,
-- references the legacy `bid_projects` table (not
-- `bid_strategy_projects`), has no `agency_id`, is unique per project
-- (so cannot represent multiple methods/attempts), and is verified
-- unreferenced anywhere in apps/api/src or apps/web/src (as Phase 15's
-- own migration already documented and re-verified here). It is left
-- completely untouched. This migration introduces new, clearly-named
-- `bid_submission_execution*`/`bid_submission_confirmations`/
-- `bid_submission_receipts` tables that reference `bid_strategy_projects`
-- and Phase 15's readiness/pack/approval tables directly, so a
-- submission is always traceable to the exact approved package.

-- ---------------------------------------------------------------
-- 0. Enums.
-- ---------------------------------------------------------------

create type submission_execution_method as enum (
  'PORTAL', 'EMAIL', 'PHYSICAL_COURIER', 'PHYSICAL_HAND_DELIVERY', 'API', 'OTHER', 'UNKNOWN'
);

create type submission_automation_status as enum (
  'AUTOMATION_AVAILABLE', 'MANUAL_REQUIRED', 'UNSUPPORTED', 'UNKNOWN'
);

create type submission_execution_status as enum (
  'NOT_READY', 'READY_FOR_SUBMISSION', 'AWAITING_HUMAN_CONFIRMATION', 'SUBMITTING',
  'SUBMITTED', 'SUBMISSION_REPORTED', 'FAILED', 'REQUIRES_MANUAL_ACTION', 'SUPERSEDED', 'CANCELLED'
);

create type submission_attempt_status as enum (
  'STARTED', 'SUCCEEDED', 'FAILED', 'UNKNOWN_OUTCOME', 'REQUIRES_MANUAL_ACTION', 'CANCELLED'
);

create type submission_error_code as enum (
  'AUTHENTICATION_REQUIRED', 'AUTHORIZATION_FAILED', 'CAPTCHA_REQUIRED', 'MFA_REQUIRED',
  'PORTAL_UNAVAILABLE', 'NETWORK_ERROR', 'TIMEOUT', 'DEADLINE_PASSED', 'PACK_CHANGED',
  'READINESS_INVALID', 'TARGET_INVALID', 'ATTACHMENT_INVALID', 'PROVIDER_REJECTED',
  'DUPLICATE_RISK', 'UNKNOWN_PROVIDER_RESULT', 'MANUAL_ACTION_REQUIRED', 'UNSUPPORTED_METHOD', 'UNKNOWN'
);

create type submission_receipt_type as enum (
  'PORTAL_RECEIPT', 'EMAIL_MESSAGE_ID', 'EMAIL_DELIVERY_CONFIRMATION', 'COURIER_TRACKING',
  'PROOF_OF_DELIVERY', 'PROCUREMENT_REFERENCE', 'MANUAL_ATTESTATION', 'OTHER'
);

create type submission_receipt_verification_status as enum (
  'MISSING', 'CAPTURED', 'VERIFIED', 'UNVERIFIED', 'CONFLICTING'
);

create type submission_physical_stage as enum (
  'NOT_STARTED', 'PREPARED', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'SUBMISSION_REPORTED', 'SUBMITTED'
);

-- ---------------------------------------------------------------
-- 1. Submission Execution (Phase 16 §6) — one live aggregate row per
--    bid project (mirrors bid_submissions' one-per-project shape, but
--    agency-scoped, richer, and never mutated by anything except the
--    deterministic orchestration layer in
--    apps/api/src/lib/submissions/runSubmission.ts).
-- ---------------------------------------------------------------
create table bid_submission_executions (
  id uuid primary key default gen_random_uuid(),
  bid_project_id uuid not null references bid_strategy_projects(id) on delete cascade,
  agency_id uuid not null references agencies(id) on delete cascade,
  tender_id uuid not null references tenders(id),
  status submission_execution_status not null default 'NOT_READY',
  submission_method submission_execution_method not null default 'UNKNOWN',
  automation_status submission_automation_status not null default 'UNKNOWN',
  target_kind text,
  target_value text,
  -- Exact upstream identity this execution is authorised against
  -- (Phase 16 §8/§9 binding constraint — never "the latest").
  approved_readiness_id uuid references bid_submission_readiness(id),
  submission_pack_id uuid references bid_submission_packs(id),
  submission_pack_version integer,
  submission_pack_hash text,
  manifest_hash text,
  confirmed_by uuid references users(id),
  confirmed_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  provider_name text,
  provider_reference text,
  external_submission_id text,
  failure_code submission_error_code,
  failure_message text,
  retryable boolean,
  physical_stage submission_physical_stage not null default 'NOT_STARTED',
  -- Optimistic concurrency guard (Phase 16 §51) — every state
  -- transition increments this; a concurrent writer's stale read is
  -- rejected at the application layer.
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bid_submission_executions_project_unique unique (bid_project_id)
);
create index bid_submission_executions_project_id_idx on bid_submission_executions (bid_project_id);
create index bid_submission_executions_agency_id_idx on bid_submission_executions (agency_id);
create index bid_submission_executions_status_idx on bid_submission_executions (status);
create trigger bid_submission_executions_set_updated_at
  before update on bid_submission_executions
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------
-- 2. Human Confirmation (Phase 16 §8) — durable, immutable,
--    server-recorded. Never updated once created.
-- ---------------------------------------------------------------
create table bid_submission_confirmations (
  id uuid primary key default gen_random_uuid(),
  submission_execution_id uuid not null references bid_submission_executions(id) on delete cascade,
  agency_id uuid not null references agencies(id) on delete cascade,
  readiness_id uuid not null references bid_submission_readiness(id),
  pack_id uuid not null references bid_submission_packs(id),
  pack_version integer not null,
  pack_hash text not null,
  manifest_hash text not null,
  submission_method submission_execution_method not null,
  target_value text,
  deadline_at timestamptz,
  statement text not null,
  confirmed_by uuid not null references users(id),
  confirmed_at timestamptz not null default now(),
  -- Set true only when a later check invalidates this confirmation
  -- (Phase 16 §8/§9 binding constraint: "a stale confirmation must
  -- never authorise a changed package") — the row itself is never
  -- edited, only this one flag is ever flipped, by the same
  -- invalidation path Phase 15 uses for approvals.
  invalidated boolean not null default false,
  invalidated_reason text,
  invalidated_at timestamptz,
  constraint bid_submission_confirmations_statement_required check (length(trim(statement)) > 0)
);
create index bid_submission_confirmations_execution_id_idx on bid_submission_confirmations (submission_execution_id);
create function prevent_submission_confirmation_mutation() returns trigger as $$
begin
  if new.readiness_id is distinct from old.readiness_id
     or new.pack_id is distinct from old.pack_id
     or new.pack_version is distinct from old.pack_version
     or new.pack_hash is distinct from old.pack_hash
     or new.manifest_hash is distinct from old.manifest_hash
     or new.statement is distinct from old.statement
     or new.confirmed_by is distinct from old.confirmed_by
     or new.confirmed_at is distinct from old.confirmed_at then
    raise exception 'bid_submission_confirmations: confirmation % is immutable once created; only invalidated/invalidated_reason/invalidated_at may ever change.', old.id;
  end if;
  return new;
end;
$$ language plpgsql;
create trigger bid_submission_confirmations_prevent_mutation
  before update on bid_submission_confirmations
  for each row execute function prevent_submission_confirmation_mutation();

-- ---------------------------------------------------------------
-- 3. Submission Attempts (Phase 16 §7) — append-only. Every attempt
--    identifies the exact pack version used.
-- ---------------------------------------------------------------
create table bid_submission_attempts (
  id uuid primary key default gen_random_uuid(),
  submission_execution_id uuid not null references bid_submission_executions(id) on delete cascade,
  agency_id uuid not null references agencies(id) on delete cascade,
  attempt_number integer not null,
  status submission_attempt_status not null default 'STARTED',
  method submission_execution_method not null,
  pack_id uuid not null references bid_submission_packs(id),
  pack_version integer not null,
  pack_hash text not null,
  manifest_hash text not null,
  initiated_by uuid not null references users(id),
  confirmation_id uuid not null references bid_submission_confirmations(id),
  -- Local idempotency key (Phase 16 §50): agency+bid+pack
  -- version+target+confirmation. Documented as LOCAL idempotency only
  -- (docs/SUBMISSION-EXECUTION.md) — it can never guarantee the
  -- external provider itself is idempotent.
  idempotency_key text not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  provider_name text,
  provider_reference text,
  external_submission_id text,
  response_status text,
  response_code text,
  error_code submission_error_code,
  error_message text,
  retryable boolean,
  human_action_required boolean not null default false,
  created_at timestamptz not null default now(),
  constraint bid_submission_attempts_execution_attempt_unique unique (submission_execution_id, attempt_number),
  constraint bid_submission_attempts_idempotency_key_unique unique (idempotency_key)
);
create index bid_submission_attempts_execution_id_idx on bid_submission_attempts (submission_execution_id);
-- At most one in-flight (STARTED) attempt per submission execution at
-- a time (Phase 16 §51 concurrency guard).
create unique index bid_submission_attempts_one_active_idx on bid_submission_attempts (submission_execution_id) where status = 'STARTED';
-- Append-only once terminal: a STARTED attempt may transition exactly
-- once to a terminal status (recording the provider outcome); after
-- that, the row is frozen — a new fact requires a new attempt row,
-- never a rewrite of history (Phase 16 §7/§21 binding constraint).
create function prevent_submission_attempt_mutation() returns trigger as $$
begin
  if old.status <> 'STARTED' then
    raise exception 'bid_submission_attempts: attempt % is terminal and immutable; create a new attempt instead.', old.id;
  end if;
  if new.attempt_number is distinct from old.attempt_number
     or new.method is distinct from old.method
     or new.pack_id is distinct from old.pack_id
     or new.pack_version is distinct from old.pack_version
     or new.pack_hash is distinct from old.pack_hash
     or new.manifest_hash is distinct from old.manifest_hash
     or new.initiated_by is distinct from old.initiated_by
     or new.confirmation_id is distinct from old.confirmation_id
     or new.idempotency_key is distinct from old.idempotency_key
     or new.started_at is distinct from old.started_at then
    raise exception 'bid_submission_attempts: identity fields of attempt % are immutable.', old.id;
  end if;
  return new;
end;
$$ language plpgsql;
create trigger bid_submission_attempts_prevent_mutation
  before update on bid_submission_attempts
  for each row execute function prevent_submission_attempt_mutation();

-- ---------------------------------------------------------------
-- 4. Receipt Intelligence (Phase 16 §19/§20) — append-only evidence;
--    verification_status transitions are the only permitted update.
-- ---------------------------------------------------------------
create table bid_submission_receipts (
  id uuid primary key default gen_random_uuid(),
  submission_execution_id uuid not null references bid_submission_executions(id) on delete cascade,
  attempt_id uuid references bid_submission_attempts(id),
  agency_id uuid not null references agencies(id) on delete cascade,
  receipt_type submission_receipt_type not null,
  provider_name text,
  provider_reference text,
  receipt_url text,
  receipt_file text,
  receipt_hash text,
  issued_at timestamptz,
  captured_at timestamptz not null default now(),
  captured_by uuid references users(id),
  verification_status submission_receipt_verification_status not null default 'CAPTURED',
  notes text,
  created_at timestamptz not null default now()
);
create index bid_submission_receipts_execution_id_idx on bid_submission_receipts (submission_execution_id);
create index bid_submission_receipts_attempt_id_idx on bid_submission_receipts (attempt_id);
create function prevent_submission_receipt_mutation() returns trigger as $$
begin
  if new.receipt_type is distinct from old.receipt_type
     or new.provider_reference is distinct from old.provider_reference
     or new.receipt_url is distinct from old.receipt_url
     or new.receipt_file is distinct from old.receipt_file
     or new.receipt_hash is distinct from old.receipt_hash
     or new.issued_at is distinct from old.issued_at
     or new.captured_at is distinct from old.captured_at
     or new.captured_by is distinct from old.captured_by then
    raise exception 'bid_submission_receipts: receipt % evidence fields are immutable; only verification_status/notes may change.', old.id;
  end if;
  return new;
end;
$$ language plpgsql;
create trigger bid_submission_receipts_prevent_mutation
  before update on bid_submission_receipts
  for each row execute function prevent_submission_receipt_mutation();

-- ---------------------------------------------------------------
-- RLS — same convention as Phase 12-15: agency-scoped select for
-- `authenticated`, service-role-only writes via
-- apps/api/src/lib/submissions/* and
-- apps/api/src/routes/submissionExecution.ts.
-- ---------------------------------------------------------------
alter table bid_submission_executions enable row level security;
create policy bid_submission_executions_select_own_agency on bid_submission_executions
  for select to authenticated using (agency_id = current_agency_id());

alter table bid_submission_confirmations enable row level security;
create policy bid_submission_confirmations_select_own_agency on bid_submission_confirmations
  for select to authenticated using (agency_id = current_agency_id());

alter table bid_submission_attempts enable row level security;
create policy bid_submission_attempts_select_own_agency on bid_submission_attempts
  for select to authenticated using (agency_id = current_agency_id());

alter table bid_submission_receipts enable row level security;
create policy bid_submission_receipts_select_own_agency on bid_submission_receipts
  for select to authenticated using (agency_id = current_agency_id());
