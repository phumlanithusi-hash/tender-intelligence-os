-- Phase 15: Final Bid Compliance, Submission Readiness & Submission Pack.
--
-- Reviewed first, per the binding spec: bid_strategy_projects,
-- bid_proposals/bid_proposal_versions/bid_proposal_sections/
-- bid_proposal_compliance_results (Phase 14, read-only),
-- bid_evidence_matches/bid_evidence_claims (Phase 13, read-only —
-- APPROVED matches + their claims remain the ONLY source of "approved
-- evidence"), tender_requirements/tender_evaluation_criteria/
-- tender_evaluation_subcriteria/tender_briefings/tender_addenda/
-- tender_documents (Phase 2/8/9, read-only), agency_documents/
-- agency_certificates (Phase 2, read-only), audit_logs (Phase 2 §22,
-- reused as-is).
--
-- COLLISION CHECK (same discipline as Phase 9-14): `bid_documents`,
-- `bid_versions`, `bid_reviews`, `bid_submissions` (Phase 2 §18,
-- 20260910200150_bid_architecture.sql) already exist, are unstructured/
-- unversioned, and are not referenced anywhere in apps/api/src or
-- apps/web/src (verified: `grep -rn "from('bid_documents')\|from('bid_versions')\|from('bid_submissions')" apps` returns nothing).
-- Left completely untouched. tender_addenda already exists
-- (20260910200100_tender_documents_addenda.sql, Phase 2 §9) — reused
-- as-is, NOT re-implemented (§26 note honoured: "check if it already
-- exists"; it does). This migration introduces new, clearly-named
-- `bid_pricing*` and `bid_submission_*` tables, none of which collide
-- with any pre-existing name.
--
-- NOTE: Phase 15 introduces no new "SUBMITTED" state anywhere (§10/§39
-- binding constraint) — the terminal deterministic/human states are
-- READY_TO_SUBMIT and APPROVED_FOR_SUBMISSION only.

-- ---------------------------------------------------------------
-- 0. Enums.
-- ---------------------------------------------------------------

create type submission_readiness_status as enum (
  'DRAFT', 'CHECKING', 'REQUIRES_REVIEW', 'BLOCKED', 'READY_TO_SUBMIT', 'APPROVED_FOR_SUBMISSION', 'SUPERSEDED'
);

create type submission_compliance_category as enum (
  'QUALIFICATION', 'MANDATORY_REQUIREMENTS', 'EVALUATION_COVERAGE', 'BRIEFING', 'ADDENDA',
  'PROPOSAL', 'EVIDENCE', 'PRICING', 'MANDATORY_DOCUMENTS', 'FORMS', 'CERTIFICATES',
  'SIGNATURES', 'FILE_FORMATS', 'FILE_NAMES', 'FILE_SIZES', 'SUBMISSION_METHOD', 'DEADLINE'
);

create type submission_item_severity as enum ('BLOCKER', 'WARNING', 'INFO');

create type submission_pricing_currency as enum ('ZAR', 'USD', 'EUR', 'GBP');

create type submission_pack_status as enum ('CURRENT', 'SUPERSEDED', 'INVALIDATED');

create type submission_approval_status as enum ('APPROVED', 'REVOKED', 'SUPERSEDED');

-- ---------------------------------------------------------------
-- 1. Pricing (Phase 15 §18/§19) — the Phase 14 pricing gap. Minimal,
--    secure, deterministic-arithmetic only; nothing here is AI-derived
--    or optimised (binding constraint §7/§18).
-- ---------------------------------------------------------------
create table bid_pricing (
  id uuid primary key default gen_random_uuid(),
  bid_project_id uuid not null references bid_strategy_projects(id) on delete cascade,
  agency_id uuid not null references agencies(id) on delete cascade,
  currency submission_pricing_currency not null default 'ZAR',
  version integer not null default 1,
  is_current boolean not null default true,
  notes text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bid_pricing_project_version_unique unique (bid_project_id, version)
);
create index bid_pricing_project_id_idx on bid_pricing (bid_project_id);
create index bid_pricing_agency_id_idx on bid_pricing (agency_id);
create unique index bid_pricing_current_unique on bid_pricing (bid_project_id) where is_current;
create trigger bid_pricing_set_updated_at
  before update on bid_pricing
  for each row execute function set_updated_at();

create table bid_pricing_items (
  id uuid primary key default gen_random_uuid(),
  pricing_id uuid not null references bid_pricing(id) on delete cascade,
  agency_id uuid not null references agencies(id) on delete cascade,
  line_number integer not null,
  description text not null,
  quantity numeric not null,
  unit text,
  unit_price numeric not null,
  -- Deterministic: line_total is application-computed
  -- (quantity * unit_price) and re-verified on every readiness check
  -- (Phase 15 §19) — never AI-estimated (§18 binding constraint).
  line_total numeric not null,
  is_mandatory_schedule_item boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bid_pricing_items_pricing_line_unique unique (pricing_id, line_number),
  constraint bid_pricing_items_quantity_non_negative check (quantity >= 0),
  constraint bid_pricing_items_unit_price_non_negative check (unit_price >= 0)
);
create index bid_pricing_items_pricing_id_idx on bid_pricing_items (pricing_id);
create trigger bid_pricing_items_set_updated_at
  before update on bid_pricing_items
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------
-- 2. Submission Readiness (Phase 15 §8/§10/§36) — one immutable
--    snapshot per compliance run; is_current marks the latest.
-- ---------------------------------------------------------------
create table bid_submission_readiness (
  id uuid primary key default gen_random_uuid(),
  bid_project_id uuid not null references bid_strategy_projects(id) on delete cascade,
  agency_id uuid not null references agencies(id) on delete cascade,
  tender_id uuid not null references tenders(id),
  status submission_readiness_status not null default 'DRAFT',
  -- Exact upstream versions this snapshot was computed against
  -- (Phase 15 §36/§53 — never "the latest").
  proposal_version_id uuid references bid_proposal_versions(id),
  pricing_id uuid references bid_pricing(id),
  -- Full deterministic-engine input/output snapshot (Phase 15 §36).
  input_snapshot jsonb not null default '{}'::jsonb,
  category_summary jsonb not null default '{}'::jsonb,
  is_current boolean not null default true,
  superseded_reason text,
  computed_by uuid references users(id),
  computed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index bid_submission_readiness_project_id_idx on bid_submission_readiness (bid_project_id);
create index bid_submission_readiness_status_idx on bid_submission_readiness (status);
create unique index bid_submission_readiness_current_unique on bid_submission_readiness (bid_project_id) where is_current;
-- Historical (non-current) readiness snapshots are immutable — a
-- later change must never silently rewrite a past decision (Phase 15
-- §36 binding constraint), mirroring Phase 14's
-- prevent_historical_proposal_version_mutation exactly.
create function prevent_historical_readiness_mutation() returns trigger as $$
begin
  if old.is_current = false and (
    new.status is distinct from old.status
    or new.input_snapshot is distinct from old.input_snapshot
    or new.category_summary is distinct from old.category_summary
    or new.proposal_version_id is distinct from old.proposal_version_id
    or new.pricing_id is distinct from old.pricing_id
  ) then
    raise exception 'bid_submission_readiness: historical snapshot % is immutable.', old.id;
  end if;
  return new;
end;
$$ language plpgsql;
create trigger bid_submission_readiness_prevent_historical_mutation
  before update on bid_submission_readiness
  for each row execute function prevent_historical_readiness_mutation();

create table bid_submission_readiness_items (
  id uuid primary key default gen_random_uuid(),
  readiness_id uuid not null references bid_submission_readiness(id) on delete cascade,
  category submission_compliance_category not null,
  severity submission_item_severity not null,
  code text not null,
  message text not null,
  source_type text,
  source_id uuid,
  resolved boolean not null default false,
  resolved_by uuid references users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index bid_submission_readiness_items_readiness_id_idx on bid_submission_readiness_items (readiness_id);
create index bid_submission_readiness_items_category_idx on bid_submission_readiness_items (category);
create index bid_submission_readiness_items_severity_idx on bid_submission_readiness_items (severity);

-- ---------------------------------------------------------------
-- 3. Submission Pack (Phase 15 §33/§34/§35) — versioned, never
--    overwritten; each file records a sha256 for integrity (§35).
-- ---------------------------------------------------------------
create table bid_submission_packs (
  id uuid primary key default gen_random_uuid(),
  bid_project_id uuid not null references bid_strategy_projects(id) on delete cascade,
  agency_id uuid not null references agencies(id) on delete cascade,
  readiness_id uuid not null references bid_submission_readiness(id),
  version integer not null,
  status submission_pack_status not null default 'CURRENT',
  manifest jsonb not null default '{}'::jsonb,
  proposal_version_id uuid references bid_proposal_versions(id),
  pricing_id uuid references bid_pricing(id),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  constraint bid_submission_packs_project_version_unique unique (bid_project_id, version)
);
create index bid_submission_packs_project_id_idx on bid_submission_packs (bid_project_id);
create unique index bid_submission_packs_current_unique on bid_submission_packs (bid_project_id) where status = 'CURRENT';
-- Never overwrite a previous pack (Phase 15 §33 binding constraint).
create function prevent_submission_pack_mutation() returns trigger as $$
begin
  if new.manifest is distinct from old.manifest
     or new.proposal_version_id is not distinct from old.proposal_version_id and new.pricing_id is distinct from old.pricing_id then
    raise exception 'bid_submission_packs: pack % content is immutable once created; create a new version instead.', old.id;
  end if;
  return new;
end;
$$ language plpgsql;
create trigger bid_submission_packs_prevent_mutation
  before update on bid_submission_packs
  for each row execute function prevent_submission_pack_mutation();

create table bid_submission_pack_files (
  id uuid primary key default gen_random_uuid(),
  pack_id uuid not null references bid_submission_packs(id) on delete cascade,
  agency_id uuid not null references agencies(id) on delete cascade,
  document_type text not null,
  file_name text not null,
  storage_path text,
  mime_type text,
  size_bytes bigint,
  sha256 text not null,
  source_table text,
  source_id uuid,
  created_at timestamptz not null default now()
);
create index bid_submission_pack_files_pack_id_idx on bid_submission_pack_files (pack_id);

-- ---------------------------------------------------------------
-- 4. Submission Manifest (Phase 15 §32) — human-readable rollup,
--    stored alongside the pack it describes.
-- ---------------------------------------------------------------
create table bid_submission_manifests (
  id uuid primary key default gen_random_uuid(),
  pack_id uuid not null references bid_submission_packs(id) on delete cascade,
  agency_id uuid not null references agencies(id) on delete cascade,
  manifest jsonb not null default '{}'::jsonb,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  constraint bid_submission_manifests_pack_unique unique (pack_id)
);
create index bid_submission_manifests_pack_id_idx on bid_submission_manifests (pack_id);

-- ---------------------------------------------------------------
-- 5. Final Approval (Phase 15 §37/§38/§53) — always references an
--    exact, immutable readiness snapshot and an exact pack version.
-- ---------------------------------------------------------------
create table bid_submission_approvals (
  id uuid primary key default gen_random_uuid(),
  bid_project_id uuid not null references bid_strategy_projects(id) on delete cascade,
  agency_id uuid not null references agencies(id) on delete cascade,
  readiness_id uuid not null references bid_submission_readiness(id),
  pack_id uuid not null references bid_submission_packs(id),
  status submission_approval_status not null default 'APPROVED',
  approval_reason text not null,
  approved_by uuid not null references users(id),
  approved_at timestamptz not null default now(),
  revoked_by uuid references users(id),
  revoked_at timestamptz,
  revoked_reason text,
  constraint bid_submission_approvals_reason_required check (length(trim(approval_reason)) > 0),
  constraint bid_submission_approvals_revoked_requires_actor check (
    status <> 'REVOKED' or (revoked_by is not null and revoked_at is not null)
  )
);
create index bid_submission_approvals_project_id_idx on bid_submission_approvals (bid_project_id);
create unique index bid_submission_approvals_active_unique on bid_submission_approvals (bid_project_id) where status = 'APPROVED';

-- ---------------------------------------------------------------
-- RLS — same convention as Phase 12/13/14: agency-scoped select for
-- `authenticated`, service-role-only writes via
-- apps/api/src/lib/submissionReadiness/* and
-- apps/api/src/routes/submissionReadiness.ts.
-- ---------------------------------------------------------------
alter table bid_pricing enable row level security;
create policy bid_pricing_select_own_agency on bid_pricing
  for select to authenticated using (agency_id = current_agency_id());

alter table bid_pricing_items enable row level security;
create policy bid_pricing_items_select_own_agency on bid_pricing_items
  for select to authenticated using (agency_id = current_agency_id());

alter table bid_submission_readiness enable row level security;
create policy bid_submission_readiness_select_own_agency on bid_submission_readiness
  for select to authenticated using (agency_id = current_agency_id());

alter table bid_submission_readiness_items enable row level security;
create policy bid_submission_readiness_items_select_own_agency on bid_submission_readiness_items
  for select to authenticated using (
    exists (select 1 from bid_submission_readiness r where r.id = bid_submission_readiness_items.readiness_id and r.agency_id = current_agency_id())
  );

alter table bid_submission_packs enable row level security;
create policy bid_submission_packs_select_own_agency on bid_submission_packs
  for select to authenticated using (agency_id = current_agency_id());

alter table bid_submission_pack_files enable row level security;
create policy bid_submission_pack_files_select_own_agency on bid_submission_pack_files
  for select to authenticated using (agency_id = current_agency_id());

alter table bid_submission_manifests enable row level security;
create policy bid_submission_manifests_select_own_agency on bid_submission_manifests
  for select to authenticated using (agency_id = current_agency_id());

alter table bid_submission_approvals enable row level security;
create policy bid_submission_approvals_select_own_agency on bid_submission_approvals
  for select to authenticated using (agency_id = current_agency_id());
