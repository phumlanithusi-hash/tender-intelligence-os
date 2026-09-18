-- Phase 7: AI Discovery & Classification.
--
-- The AI is not the source of truth (Phase 7 §2) — tender documents
-- and deterministic DB fields are. These tables persist the AI
-- layer's OWN append-only run history and evidence-grounded
-- classification output, never overwriting or reinterpreting the
-- deterministic tender/document tables built in Phase 2-6.
--
-- Design: rather than one child table per classification facet (a
-- literal reading of Phase 7 §19/§20 would produce a dozen tiny
-- tables), structured facets that are naturally list/object shaped
-- (services, deliverables, geography, contract, briefing) are stored
-- as validated JSONB on tender_ai_classifications, and every
-- individual fact within them that carries evidence gets a matching
-- row in tender_ai_claims (claim_key identifies which facet/item the
-- claim backs, e.g. 'deliverable:1', 'briefing.date'). This keeps the
-- evidence model (§16/§17) fully relational and FK-enforced — a claim
-- can only reference a real, resolved document/version/page/section/
-- chunk — while avoiding a combinatorial explosion of near-identical
-- tables. Documented as a deliberate adaptation in docs/DECISIONS.md.
--
-- Ownership/RLS: classification is inherently agency-relative (Phase
-- 7 §7 — relevance is judged against "the agency's configured
-- services"), so tender_ai_runs/tender_ai_classifications carry a
-- required agency_id and follow the SAME agency-isolated RLS shape as
-- tender_scores (20260910200140_tender_scores_risks.sql) — never the
-- shared-catalogue pattern used for tenders themselves. Child tables
-- (claims/evidence/conflicts) have no agency_id of their own and are
-- scoped by joining up to their run/classification, exactly like the
-- bid_* sub-tables pattern in 20260910200180_rls_policies.sql.

create type ai_run_status as enum ('QUEUED', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED', 'REQUIRES_REVIEW');

-- Phase 7 §2: distinguish FACT / INFERENCE / UNKNOWN / UNVERIFIED.
-- Deliberately a separate enum from `evidence_status` (Phase 2) —
-- that vocabulary is for agency credential evidence, this is the
-- AI-claim truth vocabulary the spec names explicitly.
create type ai_truth_state as enum ('FACT', 'INFERENCE', 'UNKNOWN', 'UNVERIFIED');

create type ai_relevance as enum ('RELEVANT', 'POSSIBLY_RELEVANT', 'NOT_RELEVANT', 'UNKNOWN');

create type ai_tender_type as enum (
  'RFP', 'RFQ', 'TENDER', 'EOI', 'PANEL', 'FRAMEWORK', 'APPOINTMENT', 'QUOTATION', 'OTHER', 'UNKNOWN'
);

create type ai_geographic_scope as enum (
  'NATIONAL', 'PROVINCIAL', 'MUNICIPAL', 'LOCAL', 'MULTI_PROVINCE', 'INTERNATIONAL', 'UNKNOWN'
);

create type ai_briefing_status as enum ('REQUIRED', 'OPTIONAL', 'NOT_REQUIRED', 'UNKNOWN');

-- Phase 7 §13: discovery-only apparent requirement categories (never
-- a PASS/FAIL qualification determination).
create type ai_requirement_kind as enum (
  'MIN_YEARS_EXPERIENCE', 'REQUIRED_SERVICES', 'COMPULSORY_BRIEFING', 'CSD_REGISTRATION',
  'B_BBEE', 'TAX_COMPLIANCE', 'PROFESSIONAL_REGISTRATION', 'CERTIFICATION',
  'GEOGRAPHIC_REQUIREMENT', 'REFERENCE_REQUIREMENT', 'TURNOVER_REQUIREMENT', 'OTHER'
);

create type ai_claim_type as enum (
  'RELEVANCE', 'TENDER_TYPE', 'INTENT', 'DELIVERABLE', 'GEOGRAPHY', 'CONTRACT',
  'BRIEFING', 'APPARENT_REQUIREMENT', 'CONFLICT', 'SUMMARY'
);

create type ai_conflict_field as enum ('CLOSING_DATE', 'CLOSING_TIME', 'BRIEFING_DATE', 'BRIEFING_LOCATION', 'OTHER');

-- ---------------------------------------------------------------
-- tender_ai_runs: append-only run history (Phase 7 §21/§22 — a
-- re-analysis is a NEW run row, never an overwrite of a prior one).
-- ---------------------------------------------------------------
create table tender_ai_runs (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references tenders(id) on delete cascade,
  agency_id uuid not null references agencies(id) on delete cascade,
  status ai_run_status not null default 'QUEUED',
  agent_name text not null default 'TenderClassificationAgent',
  model text not null,
  prompt_version text not null,
  input_refs jsonb not null default '{}'::jsonb,
  raw_output jsonb,
  validation_status text,
  validation_errors jsonb not null default '[]'::jsonb,
  context_truncated boolean not null default false,
  error text,
  error_stage text,
  retry_count integer not null default 0,
  input_tokens_estimate integer,
  output_tokens_estimate integer,
  duration_ms integer,
  triggered_by uuid references users(id),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tender_ai_runs_retry_count_non_negative check (retry_count >= 0)
);

create index tender_ai_runs_tender_id_idx on tender_ai_runs (tender_id);
create index tender_ai_runs_agency_id_idx on tender_ai_runs (agency_id);
create index tender_ai_runs_status_idx on tender_ai_runs (status);
-- Idempotency guard (Phase 7 §36): at most one QUEUED/RUNNING run per
-- (tender, agency) at a time — a partial unique index rather than an
-- application-only check, so a race between two near-simultaneous
-- classify requests cannot create two concurrently-active runs.
create unique index tender_ai_runs_one_active_per_tender_agency
  on tender_ai_runs (tender_id, agency_id)
  where status in ('QUEUED', 'RUNNING');

create trigger tender_ai_runs_set_updated_at
  before update on tender_ai_runs
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------
-- tender_ai_classifications: the structured, validated result of one
-- COMPLETED/PARTIAL run. `is_current` marks the latest classification
-- for a (tender, agency) pair without deleting history (Phase 7 §22).
-- ---------------------------------------------------------------
create table tender_ai_classifications (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references tender_ai_runs(id) on delete cascade,
  tender_id uuid not null references tenders(id) on delete cascade,
  agency_id uuid not null references agencies(id) on delete cascade,
  is_current boolean not null default true,

  relevance ai_relevance not null default 'UNKNOWN',
  relevance_truth ai_truth_state not null default 'UNKNOWN',
  relevance_confidence numeric,

  tender_type ai_tender_type not null default 'UNKNOWN',
  tender_type_truth ai_truth_state not null default 'UNKNOWN',
  tender_type_confidence numeric,

  intent_text text,
  intent_truth ai_truth_state not null default 'UNKNOWN',
  intent_confidence numeric,

  -- [{ serviceId, serviceName, confidence, truth }]
  services jsonb not null default '[]'::jsonb,

  geographic_scope ai_geographic_scope not null default 'UNKNOWN',
  geography_province_id uuid references provinces(id),
  geography_municipality_id uuid references municipalities(id),
  geography_truth ai_truth_state not null default 'UNKNOWN',
  geography_confidence numeric,

  -- { durationText, estimatedValue, procurementMethod, isFrameworkOrPanel,
  --   numberOfSuppliers, appointmentPeriod }, each field UNKNOWN/null if unsupported
  contract jsonb not null default '{}'::jsonb,
  contract_truth ai_truth_state not null default 'UNKNOWN',
  contract_confidence numeric,

  -- { status, date, time, location, url, isOnline, registrationRequired }
  briefing jsonb not null default '{}'::jsonb,
  briefing_status ai_briefing_status not null default 'UNKNOWN',
  briefing_truth ai_truth_state not null default 'UNKNOWN',
  briefing_confidence numeric,

  summary text,
  summary_truth ai_truth_state not null default 'UNKNOWN',

  created_at timestamptz not null default now(),
  constraint tender_ai_classifications_confidences_range check (
    (relevance_confidence is null or relevance_confidence between 0 and 1) and
    (tender_type_confidence is null or tender_type_confidence between 0 and 1) and
    (intent_confidence is null or intent_confidence between 0 and 1) and
    (geography_confidence is null or geography_confidence between 0 and 1) and
    (contract_confidence is null or contract_confidence between 0 and 1) and
    (briefing_confidence is null or briefing_confidence between 0 and 1)
  )
);

create index tender_ai_classifications_run_id_idx on tender_ai_classifications (run_id);
create index tender_ai_classifications_tender_id_idx on tender_ai_classifications (tender_id);
create index tender_ai_classifications_agency_id_idx on tender_ai_classifications (agency_id);
-- Exactly one "current" classification per (tender, agency).
create unique index tender_ai_classifications_current_unique
  on tender_ai_classifications (tender_id, agency_id)
  where is_current;

-- ---------------------------------------------------------------
-- tender_ai_deliverables / tender_ai_requirements: the two facets
-- that are naturally a growable list of discrete, individually
-- evidence-linkable items (Phase 7 §10/§13) get their own tables
-- rather than JSONB, since each item needs its own claim/evidence
-- linkage and (for requirements) a stable kind enum.
-- ---------------------------------------------------------------
create table tender_ai_deliverables (
  id uuid primary key default gen_random_uuid(),
  classification_id uuid not null references tender_ai_classifications(id) on delete cascade,
  text text not null,
  truth ai_truth_state not null default 'UNKNOWN',
  confidence numeric,
  created_at timestamptz not null default now(),
  constraint tender_ai_deliverables_confidence_range check (confidence is null or confidence between 0 and 1)
);

create index tender_ai_deliverables_classification_id_idx on tender_ai_deliverables (classification_id);

create table tender_ai_requirements (
  id uuid primary key default gen_random_uuid(),
  classification_id uuid not null references tender_ai_classifications(id) on delete cascade,
  kind ai_requirement_kind not null,
  text text not null,
  truth ai_truth_state not null default 'UNKNOWN',
  confidence numeric,
  created_at timestamptz not null default now(),
  constraint tender_ai_requirements_confidence_range check (confidence is null or confidence between 0 and 1)
);

create index tender_ai_requirements_classification_id_idx on tender_ai_requirements (classification_id);

-- ---------------------------------------------------------------
-- tender_ai_claims + tender_ai_evidence (Phase 7 §16/§17 — the
-- critical evidence model). A claim is any single fact-bearing
-- assertion the agent made; `claim_key` says which facet/item it
-- backs (e.g. 'relevance', 'deliverable:<deliverable_id>',
-- 'briefing.date', 'apparent_requirement:<requirement_id>').
-- Evidence rows are resolved server-side against the Phase 6 tables —
-- never persisted from unresolved model text (see
-- apps/api/src/lib/ai/evidence/resolver.ts).
-- ---------------------------------------------------------------
create table tender_ai_claims (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references tender_ai_runs(id) on delete cascade,
  classification_id uuid references tender_ai_classifications(id) on delete cascade,
  claim_type ai_claim_type not null,
  claim_key text not null,
  claim_text text not null,
  truth ai_truth_state not null default 'UNKNOWN',
  confidence numeric,
  evidence_resolved boolean not null default false,
  created_at timestamptz not null default now(),
  constraint tender_ai_claims_confidence_range check (confidence is null or confidence between 0 and 1)
);

create index tender_ai_claims_run_id_idx on tender_ai_claims (run_id);
create index tender_ai_claims_classification_id_idx on tender_ai_claims (classification_id);

create table tender_ai_evidence (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references tender_ai_claims(id) on delete cascade,
  document_id uuid not null references tender_documents(id),
  document_version_id uuid references tender_document_versions(id),
  page_id uuid references tender_document_pages(id),
  section_id uuid references tender_document_sections(id),
  chunk_id uuid references tender_document_chunks(id),
  page_number integer,
  -- The CANONICAL stored text the server resolved and verified —
  -- never whatever text the model echoed (Phase 7 §17).
  evidence_text text not null,
  created_at timestamptz not null default now()
);

create index tender_ai_evidence_claim_id_idx on tender_ai_evidence (claim_id);
create index tender_ai_evidence_document_id_idx on tender_ai_evidence (document_id);
create index tender_ai_evidence_chunk_id_idx on tender_ai_evidence (chunk_id);

-- ---------------------------------------------------------------
-- tender_ai_conflicts (Phase 7 §15): a document appears to disagree
-- with an authoritative deterministic tender field. Never
-- auto-applied — surfaced for human review only.
-- ---------------------------------------------------------------
create table tender_ai_conflicts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references tender_ai_runs(id) on delete cascade,
  classification_id uuid references tender_ai_classifications(id) on delete cascade,
  tender_id uuid not null references tenders(id) on delete cascade,
  field ai_conflict_field not null,
  db_value text,
  document_value text not null,
  claim_id uuid references tender_ai_claims(id),
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

create index tender_ai_conflicts_tender_id_idx on tender_ai_conflicts (tender_id);
create index tender_ai_conflicts_run_id_idx on tender_ai_conflicts (run_id);

-- ---------------------------------------------------------------
-- RLS. Runs/classifications: agency-isolated, same shape as
-- tender_scores. Claims/evidence/conflicts/deliverables/requirements:
-- no agency_id of their own — scoped by joining up to their parent,
-- exactly like the bid_* sub-table pattern.
-- ---------------------------------------------------------------
-- select-only for `authenticated` — all writes (run creation, status
-- transitions, classification persistence) go exclusively through the
-- privileged service-role client from apps/api/src/lib/ai/execution,
-- same convention as the Phase 6 document pipeline tables.
do $$
declare
  t text;
begin
  foreach t in array array['tender_ai_runs', 'tender_ai_classifications']
  loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy %I on %I for select to authenticated using (agency_id = current_agency_id())',
      t || '_select_own_agency', t
    );
  end loop;
end $$;

alter table tender_ai_deliverables enable row level security;
create policy tender_ai_deliverables_select_own_agency on tender_ai_deliverables
  for select to authenticated
  using (exists (
    select 1 from tender_ai_classifications c
    where c.id = tender_ai_deliverables.classification_id and c.agency_id = current_agency_id()
  ));

alter table tender_ai_requirements enable row level security;
create policy tender_ai_requirements_select_own_agency on tender_ai_requirements
  for select to authenticated
  using (exists (
    select 1 from tender_ai_classifications c
    where c.id = tender_ai_requirements.classification_id and c.agency_id = current_agency_id()
  ));

alter table tender_ai_claims enable row level security;
create policy tender_ai_claims_select_own_agency on tender_ai_claims
  for select to authenticated
  using (exists (
    select 1 from tender_ai_runs r
    where r.id = tender_ai_claims.run_id and r.agency_id = current_agency_id()
  ));

alter table tender_ai_evidence enable row level security;
create policy tender_ai_evidence_select_own_agency on tender_ai_evidence
  for select to authenticated
  using (exists (
    select 1 from tender_ai_claims cl
    join tender_ai_runs r on r.id = cl.run_id
    where cl.id = tender_ai_evidence.claim_id and r.agency_id = current_agency_id()
  ));

alter table tender_ai_conflicts enable row level security;
create policy tender_ai_conflicts_select_own_agency on tender_ai_conflicts
  for select to authenticated
  using (exists (
    select 1 from tender_ai_runs r
    where r.id = tender_ai_conflicts.run_id and r.agency_id = current_agency_id()
  ));

-- No authenticated insert/update/delete policies on any of the above
-- (service-role only, same convention as Phase 6 document tables) —
-- the AI pipeline always writes via the privileged server-side
-- client, never via a browser-scoped RLS client.
