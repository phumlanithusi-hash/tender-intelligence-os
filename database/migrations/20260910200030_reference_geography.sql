-- Phase 2 §7: geographic reference structures. Provinces and
-- municipalities are reference/lookup data (seeded once, rarely
-- changed), never hardcoded as free text in application logic.

create table provinces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint provinces_name_unique unique (name),
  constraint provinces_code_unique unique (code)
);

create trigger provinces_set_updated_at
  before update on provinces
  for each row execute function set_updated_at();

-- Municipalities: metros and district municipalities sit directly
-- under a province; local municipalities sit under a district
-- (parent_municipality_id). A metro has no parent and is not a
-- district; a local municipality's parent must be a district. These
-- shape rules are documented, not all mechanically enforceable by a
-- plain CHECK without a self-referential lookup — the two that are
-- cheap to enforce in SQL are below; the rest is verified in tests.
create table municipalities (
  id uuid primary key default gen_random_uuid(),
  province_id uuid not null references provinces(id),
  parent_municipality_id uuid references municipalities(id),
  name text not null,
  code text not null,
  municipality_type municipality_type not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint municipalities_code_unique unique (code),
  constraint municipalities_metro_has_no_parent
    check (municipality_type <> 'METRO' or parent_municipality_id is null),
  constraint municipalities_district_has_no_parent
    check (municipality_type <> 'DISTRICT' or parent_municipality_id is null),
  constraint municipalities_no_self_parent
    check (parent_municipality_id is null or parent_municipality_id <> id)
);

create index municipalities_province_id_idx on municipalities (province_id);
create index municipalities_parent_municipality_id_idx on municipalities (parent_municipality_id);

create trigger municipalities_set_updated_at
  before update on municipalities
  for each row execute function set_updated_at();
