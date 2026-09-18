-- Phase 13: Evidence Matching & Portfolio Intelligence.
--
-- Reviewed first, per the binding spec: agency_evidence (Phase 2,
-- read-only — its exactly-one-target pattern is mirrored below),
-- agency_documents/agency_certificates/agency_case_studies/
-- agency_references/agency_financial_records (Phase 2/8, read-only),
-- tender_document_chunks (Phase 6, read-only), bid_evidence_needs
-- (Phase 12, read-only — this phase annotates it, never forks a
-- parallel evidence-needs model), bid_strategy_projects (Phase 12,
-- read-only), audit_logs (Phase 2 §22, reused as-is), the
-- `prevent_approved_bid_strategy_mutation` trigger (Phase 12 §26,
-- pattern mirrored here for decided matches).
--
-- COLLISION CHECK (same discipline as Phase 9/10/11/12): `bid_evidence`
-- already exists (20260910200150_bid_architecture.sql, Phase 2 §18) —
-- a completely different, unstructured "attach one agency_evidence
-- row to a bid_project" table with no ranking/verification/status
-- machinery. It is not referenced anywhere in apps/api/src or
-- apps/web/src (verified) and is left completely untouched. This
-- migration introduces new, clearly-named tables instead:
-- `bid_evidence_matches` (candidate/verification/approval workflow)
-- and `bid_evidence_claims` (the human-approved linkage). Neither name
-- collides with any pre-existing table.
--
-- pgvector is already enabled (20260910200000_extensions.sql,
-- `create extension if not exists vector`) — this is simply the first
-- phase that actually writes to a vector column.

-- ---------------------------------------------------------------
-- 0. Enums.
-- ---------------------------------------------------------------

-- Embedding lifecycle (Phase 13 §A). STALE is reached only by content
-- hash drift or an explicit staleness recompute — never silently
-- reused once flagged.
create type evidence_embedding_status as enum ('NOT_EMBEDDED', 'QUEUED', 'PROCESSING', 'READY', 'STALE', 'FAILED');

-- Mirrors agency_evidence's evidence_type vocabulary but scoped to
-- exactly what Phase 13 embeds (Phase 6 tender document chunks are
-- deliberately NOT included here — see the separate
-- tender_evidence_chunk_embeddings table below and docs/DECISIONS.md
-- for why they get their own, tender-scoped table rather than being
-- forced into this agency-scoped one).
create type evidence_embedding_entity_type as enum ('AGENCY_DOCUMENT', 'AGENCY_CERTIFICATE', 'AGENCY_CASE_STUDY', 'AGENCY_REFERENCE', 'AGENCY_FINANCIAL_RECORD');

-- Phase 13 §C (binding constraint): AI/semantic scoring can produce at
-- most VERIFIED. APPROVED/REJECTED are exclusively human-actioned end
-- states; SUPERSEDED marks a decided match displaced by a re-run.
create type evidence_match_status as enum ('CANDIDATE', 'REQUIRES_VERIFICATION', 'VERIFIED', 'APPROVED', 'REJECTED', 'SUPERSEDED');

-- ---------------------------------------------------------------
-- 1. agency_evidence_embeddings (Phase 13 §A) — one row per
--    (agency evidence row), agency-scoped, pgvector column.
-- ---------------------------------------------------------------
create table agency_evidence_embeddings (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  entity_type evidence_embedding_entity_type not null,
  document_evidence_id uuid references agency_documents(id) on delete cascade,
  certificate_evidence_id uuid references agency_certificates(id) on delete cascade,
  case_study_evidence_id uuid references agency_case_studies(id) on delete cascade,
  reference_evidence_id uuid references agency_references(id) on delete cascade,
  financial_record_evidence_id uuid references agency_financial_records(id) on delete cascade,
  status evidence_embedding_status not null default 'NOT_EMBEDDED',
  -- sha256 of the canonical text that was (or is about to be)
  -- embedded — a change here, compared against a freshly-computed
  -- hash, is what flags STALE (Phase 13 §A "never silently reused").
  content_hash text,
  embedded_content text,
  embedding vector(1536),
  embedding_model text,
  last_error text,
  queued_at timestamptz,
  embedded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agency_evidence_embeddings_exactly_one_target check (
    (case when document_evidence_id is not null then 1 else 0 end)
    + (case when certificate_evidence_id is not null then 1 else 0 end)
    + (case when case_study_evidence_id is not null then 1 else 0 end)
    + (case when reference_evidence_id is not null then 1 else 0 end)
    + (case when financial_record_evidence_id is not null then 1 else 0 end)
    = 1
  ),
  -- A READY/STALE embedding must actually carry a vector; a
  -- NOT_EMBEDDED/QUEUED/PROCESSING/FAILED row never fabricates one.
  constraint agency_evidence_embeddings_vector_matches_status check (
    (status in ('READY', 'STALE') and embedding is not null)
    or (status not in ('READY', 'STALE') and embedding is null)
  ),
  constraint agency_evidence_embeddings_one_per_entity unique (entity_type, document_evidence_id, certificate_evidence_id, case_study_evidence_id, reference_evidence_id, financial_record_evidence_id)
);

-- One embedding row per underlying evidence row, regardless of which
-- FK column it fills (the exactly-one-target CHECK above guarantees
-- only one is ever non-null) -- these are what
-- supabaseEvidenceMatchingStore.ts upserts on, one per entity type.
create unique index agency_evidence_embeddings_document_unique on agency_evidence_embeddings (document_evidence_id) where document_evidence_id is not null;
create unique index agency_evidence_embeddings_certificate_unique on agency_evidence_embeddings (certificate_evidence_id) where certificate_evidence_id is not null;
create unique index agency_evidence_embeddings_case_study_unique on agency_evidence_embeddings (case_study_evidence_id) where case_study_evidence_id is not null;
create unique index agency_evidence_embeddings_reference_unique on agency_evidence_embeddings (reference_evidence_id) where reference_evidence_id is not null;
create unique index agency_evidence_embeddings_financial_record_unique on agency_evidence_embeddings (financial_record_evidence_id) where financial_record_evidence_id is not null;

create index agency_evidence_embeddings_agency_id_idx on agency_evidence_embeddings (agency_id);
create index agency_evidence_embeddings_status_idx on agency_evidence_embeddings (status);
-- Agency-scoped ANN index (Phase 13 §11 binding constraint: every
-- vector query must be `WHERE agency_id = ... ORDER BY embedding <=>
-- ... LIMIT topK` — never a cross-tenant scan). ivfflat still requires
-- the WHERE clause at query time to stay tenant-safe; the agency_id
-- b-tree index above is what makes that filter cheap.
create index agency_evidence_embeddings_embedding_idx on agency_evidence_embeddings using ivfflat (embedding vector_cosine_ops) with (lists = 100) where embedding is not null;

create trigger agency_evidence_embeddings_set_updated_at
  before update on agency_evidence_embeddings
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------
-- 2. tender_evidence_chunk_embeddings (Phase 13 §A, scope decision —
--    see docs/DECISIONS.md) — tender_document_chunks are owned by a
--    tender, not an agency, so they get their own tender-scoped table
--    with the same shared-catalogue RLS pattern as
--    tender_document_chunks itself (Phase 6), rather than being
--    force-fit into the agency-scoped table above or joined
--    cross-tenant. Used only as optional retrieval context when
--    ranking an evidence need against agency evidence (e.g. embedding
--    an evaluation criterion's own source chunk) — never queried
--    across tenders.
-- ---------------------------------------------------------------
create table tender_evidence_chunk_embeddings (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references tenders(id) on delete cascade,
  chunk_id uuid not null references tender_document_chunks(id) on delete cascade,
  status evidence_embedding_status not null default 'NOT_EMBEDDED',
  content_hash text,
  embedding vector(1536),
  embedding_model text,
  last_error text,
  queued_at timestamptz,
  embedded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tender_evidence_chunk_embeddings_chunk_unique unique (chunk_id),
  constraint tender_evidence_chunk_embeddings_vector_matches_status check (
    (status in ('READY', 'STALE') and embedding is not null)
    or (status not in ('READY', 'STALE') and embedding is null)
  )
);
create index tender_evidence_chunk_embeddings_tender_id_idx on tender_evidence_chunk_embeddings (tender_id);
create trigger tender_evidence_chunk_embeddings_set_updated_at
  before update on tender_evidence_chunk_embeddings
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------
-- 3. bid_evidence_matches (Phase 13 §D) — one row per (evidence need x
--    candidate) evaluation, APPEND-ONLY on status change (Phase 13
--    §5/§D binding constraint): re-running candidate generation, or
--    re-evaluating a candidate, never mutates a decided row — it is
--    superseded (old row -> SUPERSEDED, a fresh row inserted).
-- ---------------------------------------------------------------
create table bid_evidence_matches (
  id uuid primary key default gen_random_uuid(),
  bid_project_id uuid not null references bid_strategy_projects(id) on delete cascade,
  agency_id uuid not null references agencies(id) on delete cascade,
  evidence_need_id uuid not null references bid_evidence_needs(id) on delete cascade,
  candidate_entity_type evidence_embedding_entity_type not null,
  candidate_embedding_id uuid references agency_evidence_embeddings(id),
  document_evidence_id uuid references agency_documents(id),
  certificate_evidence_id uuid references agency_certificates(id),
  case_study_evidence_id uuid references agency_case_studies(id),
  reference_evidence_id uuid references agency_references(id),
  financial_record_evidence_id uuid references agency_financial_records(id),
  status evidence_match_status not null default 'CANDIDATE',
  -- Retrieval/ranking output (Phase 13 §B) — advisory only, never
  -- itself a verification or approval signal.
  semantic_score numeric,
  rank_factors jsonb not null default '{}'::jsonb,
  rationale text,
  -- Deterministic verification output (Phase 13 §C) — authoritative
  -- for structural fit; independent of and never overridden by the
  -- semantic score above.
  verification_result jsonb not null default '{}'::jsonb,
  verification_passed boolean,
  -- Human decision (Phase 13 §D) — the only path to APPROVED/REJECTED.
  decided_by uuid references users(id),
  decided_at timestamptz,
  rejection_reason text,
  -- Append-only versioning (Phase 13 §5/§F): the prior row this one
  -- supersedes (a re-run, or a re-evaluation after staleness).
  supersedes_match_id uuid references bid_evidence_matches(id),
  is_current boolean not null default true,
  -- Staleness inputs snapshot (Phase 13 §F), same isSnapshotStale
  -- mechanism as every prior phase.
  input_snapshot jsonb not null default '{}'::jsonb,
  is_stale boolean not null default false,
  run_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bid_evidence_matches_candidate_exactly_one_target check (
    (case when document_evidence_id is not null then 1 else 0 end)
    + (case when certificate_evidence_id is not null then 1 else 0 end)
    + (case when case_study_evidence_id is not null then 1 else 0 end)
    + (case when reference_evidence_id is not null then 1 else 0 end)
    + (case when financial_record_evidence_id is not null then 1 else 0 end)
    = 1
  ),
  -- Phase 13 §D (binding constraint, mirrors bid_questions'
  -- answer/answer_source CHECK from Phase 12): a rejection always
  -- carries a reason.
  constraint bid_evidence_matches_rejection_requires_reason check (
    status <> 'REJECTED' or (rejection_reason is not null and length(trim(rejection_reason)) > 0)
  ),
  -- A decided match (APPROVED/REJECTED) always records who/when.
  constraint bid_evidence_matches_decided_requires_actor check (
    status not in ('APPROVED', 'REJECTED') or (decided_by is not null and decided_at is not null)
  )
);

create index bid_evidence_matches_project_id_idx on bid_evidence_matches (bid_project_id);
create index bid_evidence_matches_need_id_idx on bid_evidence_matches (evidence_need_id);
create index bid_evidence_matches_status_idx on bid_evidence_matches (status);
create index bid_evidence_matches_agency_id_idx on bid_evidence_matches (agency_id);
-- At most one CURRENT row per (evidence_need_id, candidate) pairing —
-- re-evaluation supersedes rather than duplicates.
create unique index bid_evidence_matches_current_unique on bid_evidence_matches (evidence_need_id, candidate_entity_type, coalesce(document_evidence_id, certificate_evidence_id, case_study_evidence_id, reference_evidence_id, financial_record_evidence_id)) where is_current;

create trigger bid_evidence_matches_set_updated_at
  before update on bid_evidence_matches
  for each row execute function set_updated_at();

-- Phase 13 §D (binding constraint, mirrors Phase 12's
-- prevent_approved_bid_strategy_mutation): once a human has decided a
-- match (APPROVED or REJECTED), that row is immutable at the DB
-- level. The only permitted transition out of a decided status is
-- superseding on creation of a fresh re-evaluation row
-- (is_current -> false, status -> SUPERSEDED).
create function prevent_decided_evidence_match_mutation() returns trigger as $$
begin
  if old.status in ('APPROVED', 'REJECTED') then
    if new.status = 'SUPERSEDED' and new.is_current = false
       and new.decided_by is not distinct from old.decided_by
       and new.decided_at is not distinct from old.decided_at
       and new.rejection_reason is not distinct from old.rejection_reason
       and new.semantic_score is not distinct from old.semantic_score
       and new.rank_factors is not distinct from old.rank_factors
       and new.rationale is not distinct from old.rationale
       and new.verification_result is not distinct from old.verification_result
       and new.verification_passed is not distinct from old.verification_passed then
      return new; -- allowed: superseding bookkeeping only, every decided/scored field untouched
    end if;
    -- Allow pure staleness-flag bookkeeping (is_stale) without
    -- touching the decision or any scored/verification field.
    if new.status = old.status and new.is_current = old.is_current
       and new.decided_by is not distinct from old.decided_by
       and new.decided_at is not distinct from old.decided_at
       and new.rejection_reason is not distinct from old.rejection_reason
       and new.semantic_score is not distinct from old.semantic_score
       and new.rank_factors is not distinct from old.rank_factors
       and new.rationale is not distinct from old.rationale
       and new.verification_result is not distinct from old.verification_result
       and new.verification_passed is not distinct from old.verification_passed then
      return new;
    end if;
    raise exception 'bid_evidence_matches: a decided match (status=%, id=%) is immutable. Create a new evaluation row instead.', old.status, old.id;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger bid_evidence_matches_prevent_decided_mutation
  before update on bid_evidence_matches
  for each row execute function prevent_decided_evidence_match_mutation();

-- ---------------------------------------------------------------
-- 4. bid_evidence_claims (Phase 13 §D) — the authoritative,
--    human-approved "this evidence satisfies this need" record. One
--    row is created only when a bid_evidence_matches row is APPROVED;
--    never written directly by any AI/semantic path.
-- ---------------------------------------------------------------
create table bid_evidence_claims (
  id uuid primary key default gen_random_uuid(),
  bid_project_id uuid not null references bid_strategy_projects(id) on delete cascade,
  agency_id uuid not null references agencies(id) on delete cascade,
  evidence_need_id uuid not null references bid_evidence_needs(id) on delete cascade,
  match_id uuid not null references bid_evidence_matches(id),
  candidate_entity_type evidence_embedding_entity_type not null,
  document_evidence_id uuid references agency_documents(id),
  certificate_evidence_id uuid references agency_certificates(id),
  case_study_evidence_id uuid references agency_case_studies(id),
  reference_evidence_id uuid references agency_references(id),
  financial_record_evidence_id uuid references agency_financial_records(id),
  approved_by uuid not null references users(id),
  approved_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references users(id),
  revoked_reason text,
  created_at timestamptz not null default now(),
  constraint bid_evidence_claims_exactly_one_target check (
    (case when document_evidence_id is not null then 1 else 0 end)
    + (case when certificate_evidence_id is not null then 1 else 0 end)
    + (case when case_study_evidence_id is not null then 1 else 0 end)
    + (case when reference_evidence_id is not null then 1 else 0 end)
    + (case when financial_record_evidence_id is not null then 1 else 0 end)
    = 1
  ),
  constraint bid_evidence_claims_revoked_requires_reason check (
    revoked_at is null or (revoked_reason is not null and length(trim(revoked_reason)) > 0)
  )
);

create index bid_evidence_claims_project_id_idx on bid_evidence_claims (bid_project_id);
create index bid_evidence_claims_need_id_idx on bid_evidence_claims (evidence_need_id);
-- At most one ACTIVE (non-revoked) claim per evidence need — a need
-- can be satisfied by more than one approved match only sequentially
-- (revoke, then approve a new one), never two simultaneous live claims
-- for the same need.
create unique index bid_evidence_claims_active_per_need_unique on bid_evidence_claims (evidence_need_id) where revoked_at is null;

-- ---------------------------------------------------------------
-- RLS — same convention as every prior phase: agency-scoped select
-- for `authenticated`, service-role-only writes.
-- ---------------------------------------------------------------
alter table agency_evidence_embeddings enable row level security;
create policy agency_evidence_embeddings_select_own_agency on agency_evidence_embeddings
  for select to authenticated using (agency_id = current_agency_id());

alter table tender_evidence_chunk_embeddings enable row level security;
create policy tender_evidence_chunk_embeddings_select_authenticated on tender_evidence_chunk_embeddings
  for select to authenticated using (true);

alter table bid_evidence_matches enable row level security;
create policy bid_evidence_matches_select_own_agency on bid_evidence_matches
  for select to authenticated using (agency_id = current_agency_id());

alter table bid_evidence_claims enable row level security;
create policy bid_evidence_claims_select_own_agency on bid_evidence_claims
  for select to authenticated using (agency_id = current_agency_id());

-- No authenticated insert/update/delete policy anywhere in this
-- migration — service-role only. All writes go through
-- apps/api/src/lib/evidenceMatching/* and
-- apps/api/src/routes/evidenceMatching.ts, which enforce role gating
-- (view vs. approve/reject) and business rules (rejection reason,
-- immutability, agency ownership) before ever reaching these tables.

-- ---------------------------------------------------------------
-- 5. match_agency_evidence_embeddings(agency, query_embedding, top_k)
--    Phase 13 §11 (binding constraint): the ONLY place a vector
--    similarity query happens. Always `where agency_id = p_agency_id`
--    before the `order by ... <=>` -- never a cross-tenant ANN scan.
--    Called exclusively from apps/api/src/lib/evidenceMatching/
--    supabaseEvidenceMatchingStore.ts via supabase.rpc(...); the pure
--    rankEvidenceCandidates() function never performs this query
--    itself (retrieval/ranking split, Phase 13 §B).
-- ---------------------------------------------------------------
create function match_agency_evidence_embeddings(
  p_agency_id uuid,
  p_query_embedding vector(1536),
  p_top_k integer default 10
) returns table (
  id uuid,
  entity_type evidence_embedding_entity_type,
  document_evidence_id uuid,
  certificate_evidence_id uuid,
  case_study_evidence_id uuid,
  reference_evidence_id uuid,
  financial_record_evidence_id uuid,
  content_hash text,
  embedded_at timestamptz,
  similarity numeric
) language sql stable as $$
  select e.id, e.entity_type, e.document_evidence_id, e.certificate_evidence_id,
         e.case_study_evidence_id, e.reference_evidence_id, e.financial_record_evidence_id,
         e.content_hash, e.embedded_at,
         (1 - (e.embedding <=> p_query_embedding))::numeric as similarity
  from agency_evidence_embeddings e
  where e.agency_id = p_agency_id
    and e.status in ('READY', 'STALE')
    and e.embedding is not null
  order by e.embedding <=> p_query_embedding
  limit greatest(p_top_k, 0);
$$;
