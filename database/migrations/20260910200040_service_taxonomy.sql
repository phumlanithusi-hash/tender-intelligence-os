-- Phase 2 §6: configurable service taxonomy. Never hardcoded into
-- application code (master spec §6) — the admin can add services,
-- subcategories, and (in a later phase) keywords/synonyms/exclusions
-- without a code change.

create table services (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  description text,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint services_slug_unique unique (slug)
);

create trigger services_set_updated_at
  before update on services
  for each row execute function set_updated_at();

create table service_subcategories (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references services(id) on delete cascade,
  name text not null,
  slug text not null,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_subcategories_service_slug_unique unique (service_id, slug)
);

create index service_subcategories_service_id_idx on service_subcategories (service_id);

create trigger service_subcategories_set_updated_at
  before update on service_subcategories
  for each row execute function set_updated_at();
