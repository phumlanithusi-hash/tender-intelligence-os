-- Phase 2 §3: tender source registry. A source's own health fields
-- are how the platform reports honest coverage (master spec §5) —
-- "all opportunities discovered across the configured tender-source
-- network," never "every tender on the internet."
create table tender_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  base_url text not null,
  source_type source_type not null,
  authority_level authority_level not null,
  jurisdiction text,
  active boolean not null default true,
  scan_frequency interval not null default interval '1 day',
  requires_login boolean not null default false,
  supports_documents boolean not null default true,
  -- Set only once a real adapter exists (Phase 4/5+). A source with no
  -- automated adapter yet is still recorded — never silently dropped
  -- from coverage reporting (Phase 2 §3: "do not claim these sources
  -- are automatically scrapeable yet").
  requires_manual_ingestion boolean not null default true,
  last_scan_at timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  error_count integer not null default 0,
  health_status source_health not null default 'DISABLED',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tender_sources_name_unique unique (name),
  constraint tender_sources_error_count_non_negative check (error_count >= 0)
);

create index tender_sources_health_status_idx on tender_sources (health_status);
create index tender_sources_active_idx on tender_sources (active);

create trigger tender_sources_set_updated_at
  before update on tender_sources
  for each row execute function set_updated_at();
