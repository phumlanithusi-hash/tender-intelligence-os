-- Phase 2 §15: agency data architecture. Every agency-owned table
-- carries agency_id (multi-tenancy preparation, docs/DATABASE.md §1)
-- and is isolated by Row Level Security (migration ...rls_policies.sql).

-- users mirrors auth.users (Supabase Auth is the source of truth for
-- credentials); this table holds only the app-level profile + role +
-- agency membership needed for RLS and RBAC (docs/SECURITY.md §2/§3).
create table users (
  id uuid primary key references auth.users(id) on delete cascade,
  agency_id uuid,
  role user_role not null default 'VIEWER',
  full_name text,
  email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index users_agency_id_idx on users (agency_id);

create trigger users_set_updated_at
  before update on users
  for each row execute function set_updated_at();

create table agencies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  registration_number text,
  -- Credential-like fields each carry their own evidence_status so a
  -- claimed B-BBEE level or tax status is never presented as fact
  -- without knowing where it came from (master spec §3, Phase 2 §23).
  b_bbee_level text,
  b_bbee_status evidence_status not null default 'UNKNOWN',
  csd_number text,
  tax_status text,
  tax_status_status evidence_status not null default 'UNKNOWN',
  turnover_band text,
  years_in_business integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agencies_years_in_business_non_negative check (years_in_business is null or years_in_business >= 0)
);

-- Deferred so users.agency_id can reference agencies without a
-- create-order cycle between the two tables.
alter table users
  add constraint users_agency_id_fkey foreign key (agency_id) references agencies(id);

create trigger agencies_set_updated_at
  before update on agencies
  for each row execute function set_updated_at();

create table agency_team (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  name text not null,
  role_title text,
  bio text,
  cv_document_id uuid,
  is_key_personnel boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index agency_team_agency_id_idx on agency_team (agency_id);

create trigger agency_team_set_updated_at
  before update on agency_team
  for each row execute function set_updated_at();

create table agency_documents (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  document_type text not null,
  file_hash text,
  storage_path text,
  expiry_date date,
  status evidence_status not null default 'UNKNOWN',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index agency_documents_agency_id_idx on agency_documents (agency_id);

create trigger agency_documents_set_updated_at
  before update on agency_documents
  for each row execute function set_updated_at();

create table agency_certificates (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  certificate_type text not null,
  issuing_body text,
  issue_date date,
  expiry_date date,
  document_id uuid references agency_documents(id),
  status evidence_status not null default 'UNKNOWN',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index agency_certificates_agency_id_idx on agency_certificates (agency_id);
create index agency_certificates_expiry_date_idx on agency_certificates (expiry_date);

create trigger agency_certificates_set_updated_at
  before update on agency_certificates
  for each row execute function set_updated_at();

create table agency_clients (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  name text not null,
  industry text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index agency_clients_agency_id_idx on agency_clients (agency_id);

create trigger agency_clients_set_updated_at
  before update on agency_clients
  for each row execute function set_updated_at();

create table agency_references (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  client_id uuid references agency_clients(id),
  contact_name text,
  contact_email text,
  contact_phone text,
  is_current boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index agency_references_agency_id_idx on agency_references (agency_id);

create trigger agency_references_set_updated_at
  before update on agency_references
  for each row execute function set_updated_at();

create table agency_policies (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  policy_type text not null,
  title text not null,
  document_id uuid references agency_documents(id),
  effective_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index agency_policies_agency_id_idx on agency_policies (agency_id);

create trigger agency_policies_set_updated_at
  before update on agency_policies
  for each row execute function set_updated_at();

-- Phase 2 §16: rich case study schema. Results/clients/budgets are
-- never fabricated (master spec §3) — evidence_status makes the
-- verification state of the whole case study explicit and queryable.
create table agency_case_studies (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  project text not null,
  client text,
  client_id uuid references agency_clients(id),
  industry text,
  year integer,
  budget numeric,
  deliverables text,
  challenge text,
  solution text,
  results text,
  team text,
  images text[] not null default '{}',
  url text,
  reference_contact_id uuid references agency_references(id),
  evidence_status evidence_status not null default 'UNVERIFIED',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agency_case_studies_year_sane check (year is null or (year between 1900 and 2200))
);

create index agency_case_studies_agency_id_idx on agency_case_studies (agency_id);

create trigger agency_case_studies_set_updated_at
  before update on agency_case_studies
  for each row execute function set_updated_at();

-- Phase 2 §6: agencies <-> services many-to-many, backed by the
-- configurable taxonomy rather than free text.
create table agency_services (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  service_id uuid not null references services(id),
  subcategory_id uuid references service_subcategories(id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agency_services_unique unique (agency_id, service_id, subcategory_id)
);

create index agency_services_agency_id_idx on agency_services (agency_id);
create index agency_services_service_id_idx on agency_services (service_id);

create trigger agency_services_set_updated_at
  before update on agency_services
  for each row execute function set_updated_at();
