-- Phase 2 §13: opportunity scoring. Application code calculates the
-- final score and total; AI may only supply the per-dimension
-- evidence that informs the values written here (docs/AI-ARCHITECTURE.md
-- §4). This table stores the *result* of that deterministic
-- calculation, not a live formula — scoring_version records which
-- version of the formula produced it, so a later change in weights
-- doesn't retroactively reinterpret old scores.
--
-- agency_id is not in the master spec's literal field list for this
-- table, but the score is inherently agency-specific (service fit,
-- qualification likelihood, etc. are relative to one agency's
-- capabilities) — added here as a required column and logged as a
-- deliberate addition in docs/DECISIONS.md, consistent with "All
-- agency-owned records must include agency_id" (Phase 2 §15) even
-- though this row is not one of the tables §15 explicitly lists.
create table tender_scores (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references tenders(id) on delete cascade,
  agency_id uuid not null references agencies(id) on delete cascade,
  service_fit numeric not null,
  qualification_likelihood numeric not null,
  relevant_experience numeric not null,
  functionality_potential numeric not null,
  commercial_value numeric not null,
  competition numeric not null,
  time_available numeric not null,
  compliance_risk numeric not null,
  strategic_value numeric not null,
  total_score numeric not null,
  score_class bid_decision not null,
  mandatory_failure boolean not null default false,
  mandatory_failure_reason text,
  scoring_version text not null,
  calculated_at timestamptz not null default now(),
  constraint tender_scores_dimensions_in_range check (
    service_fit between 0 and 20
    and qualification_likelihood between 0 and 20
    and relevant_experience between 0 and 15
    and functionality_potential between 0 and 15
    and commercial_value between 0 and 10
    and competition between 0 and 5
    and time_available between 0 and 5
    and compliance_risk between 0 and 5
    and strategic_value between 0 and 5
  ),
  constraint tender_scores_total_score_range check (total_score between 0 and 100),
  -- A mandatory failure must always carry its reason, and a
  -- mandatory-failed score is always classified NO_BID regardless of
  -- the numeric total — the override the master spec's worked example
  -- (§22) describes is enforced here, not left to application
  -- discipline alone.
  constraint tender_scores_mandatory_failure_has_reason
    check (not mandatory_failure or mandatory_failure_reason is not null),
  constraint tender_scores_mandatory_failure_forces_no_bid
    check (not mandatory_failure or score_class = 'NO_BID')
);

create index tender_scores_tender_id_idx on tender_scores (tender_id);
create index tender_scores_agency_id_idx on tender_scores (agency_id);
create index tender_scores_score_class_idx on tender_scores (score_class);
-- Fast "current score" lookup: latest row per (tender_id, agency_id).
create index tender_scores_tender_agency_calculated_idx
  on tender_scores (tender_id, agency_id, calculated_at desc);

-- Phase 2 §14: risks. agency_id is nullable because some risk types
-- are inherent to the tender itself (DEADLINE, PRICING, CONTRACT)
-- while others are specific to one agency's situation (CAPACITY,
-- QUALIFICATION) — null means "applies generally," a set value means
-- "specific to this agency's bid." This is an addition beyond the
-- literal field list in Phase 2 §14, logged in docs/DECISIONS.md.
create table tender_risks (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references tenders(id) on delete cascade,
  agency_id uuid references agencies(id) on delete cascade,
  risk_type risk_type not null,
  severity severity not null,
  description text not null,
  evidence text,
  source_document_id uuid references tender_documents(id),
  mitigation text,
  status risk_status not null default 'OPEN',
  confidence numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tender_risks_confidence_range check (confidence is null or (confidence >= 0 and confidence <= 1))
);

create index tender_risks_tender_id_idx on tender_risks (tender_id);
create index tender_risks_agency_id_idx on tender_risks (agency_id) where agency_id is not null;
create index tender_risks_severity_idx on tender_risks (severity);
create index tender_risks_status_idx on tender_risks (status);

create trigger tender_risks_set_updated_at
  before update on tender_risks
  for each row execute function set_updated_at();
