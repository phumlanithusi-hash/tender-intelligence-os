-- Phase 2 §11: evaluation criteria. The schema must not assume a
-- generic 80/20 (technical/price) model — weight is nullable and the
-- set of criteria is entirely data-driven per tender. The actual
-- tender evaluation model always takes precedence over any default
-- (master spec §17/§22, Phase 2 §11).
create table tender_evaluation_criteria (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references tenders(id) on delete cascade,
  criterion text not null,
  description text,
  weight numeric,
  scoring_method scoring_method,
  minimum_score numeric,
  source_document_id uuid references tender_documents(id),
  page_number integer,
  evidence_text text,
  confidence numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tender_evaluation_criteria_weight_range
    check (weight is null or (weight >= 0 and weight <= 100)),
  constraint tender_evaluation_criteria_confidence_range
    check (confidence is null or (confidence >= 0 and confidence <= 1)),
  constraint tender_evaluation_criteria_page_number_positive
    check (page_number is null or page_number >= 1)
);

create index tender_evaluation_criteria_tender_id_idx on tender_evaluation_criteria (tender_id);

create trigger tender_evaluation_criteria_set_updated_at
  before update on tender_evaluation_criteria
  for each row execute function set_updated_at();

create table tender_evaluation_subcriteria (
  id uuid primary key default gen_random_uuid(),
  evaluation_criterion_id uuid not null references tender_evaluation_criteria(id) on delete cascade,
  criterion text not null,
  description text,
  weight numeric,
  scoring_method scoring_method,
  evidence text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tender_evaluation_subcriteria_weight_range
    check (weight is null or (weight >= 0 and weight <= 100))
);

create index tender_evaluation_subcriteria_criterion_id_idx on tender_evaluation_subcriteria (evaluation_criterion_id);

create trigger tender_evaluation_subcriteria_set_updated_at
  before update on tender_evaluation_subcriteria
  for each row execute function set_updated_at();
