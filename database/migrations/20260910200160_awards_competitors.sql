-- Phase 2 §19/§20: awards and competitor intelligence. Every row
-- carries confidence and source_url so a claimed outcome is never
-- presented with more certainty than the evidence supports (master
-- spec §35/§36: "Do not fabricate competitor data" / award info).
create table awards (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references tenders(id),
  winner text,
  award_value numeric,
  award_date date,
  contract_duration text,
  source text,
  source_url text,
  confidence award_confidence not null default 'INFERRED',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint awards_award_value_non_negative check (award_value is null or award_value >= 0)
);

create index awards_tender_id_idx on awards (tender_id);

create trigger awards_set_updated_at
  before update on awards
  for each row execute function set_updated_at();

create table competitors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint competitors_name_unique unique (name)
);

create trigger competitors_set_updated_at
  before update on competitors
  for each row execute function set_updated_at();

create table competitor_activity (
  id uuid primary key default gen_random_uuid(),
  competitor_id uuid not null references competitors(id) on delete cascade,
  tender_id uuid references tenders(id),
  award_id uuid references awards(id),
  activity_type competitor_activity_type not null,
  value numeric,
  source text,
  source_url text,
  confidence award_confidence not null default 'INFERRED',
  notes text,
  created_at timestamptz not null default now(),
  constraint competitor_activity_value_non_negative check (value is null or value >= 0)
);

create index competitor_activity_competitor_id_idx on competitor_activity (competitor_id);
create index competitor_activity_tender_id_idx on competitor_activity (tender_id) where tender_id is not null;
