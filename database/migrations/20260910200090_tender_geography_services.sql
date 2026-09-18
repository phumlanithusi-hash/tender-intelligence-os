-- Phase 2 §7: structured geographic scope. A tender can apply to
-- more than one place (e.g. several municipalities), so this is a
-- one-to-many table rather than a single column on tenders — the
-- denormalised tenders.province/municipality text columns remain for
-- quick display only (see tenders_core.sql).
create table tender_geographic_scope (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references tenders(id) on delete cascade,
  scope_type geographic_scope_type not null,
  province_id uuid references provinces(id),
  municipality_id uuid references municipalities(id),
  custom_area_description text,
  created_at timestamptz not null default now(),
  constraint tender_geographic_scope_fields_match_type check (
    (scope_type = 'NATIONAL' and province_id is null and municipality_id is null and custom_area_description is null)
    or (scope_type = 'PROVINCE' and province_id is not null and municipality_id is null)
    or (scope_type in ('DISTRICT', 'METRO', 'LOCAL_MUNICIPALITY') and municipality_id is not null)
    or (scope_type = 'CUSTOM_AREA' and custom_area_description is not null)
  )
);

create index tender_geographic_scope_tender_id_idx on tender_geographic_scope (tender_id);
create index tender_geographic_scope_province_id_idx on tender_geographic_scope (province_id) where province_id is not null;
create index tender_geographic_scope_municipality_id_idx on tender_geographic_scope (municipality_id) where municipality_id is not null;

-- Phase 2 §6: tenders <-> services many-to-many. Populated by the
-- classification agent starting Phase 7 — the table exists from
-- Phase 2 so "which tenders match our agency's capabilities" is
-- answerable by a join the moment classification data exists,
-- without a later schema change.
create table tender_services (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references tenders(id) on delete cascade,
  service_id uuid not null references services(id),
  subcategory_id uuid references service_subcategories(id),
  is_primary boolean not null default false,
  confidence numeric,
  created_at timestamptz not null default now(),
  constraint tender_services_unique unique (tender_id, service_id, subcategory_id),
  constraint tender_services_confidence_range
    check (confidence is null or (confidence >= 0 and confidence <= 1))
);

create index tender_services_tender_id_idx on tender_services (tender_id);
create index tender_services_service_id_idx on tender_services (service_id);
