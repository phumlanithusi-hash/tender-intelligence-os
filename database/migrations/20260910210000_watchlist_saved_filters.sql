-- Phase 3 §15/§16: watchlist and saved filters.
-- Both are genuinely agency/user data, not merely a UI convenience —
-- watching a tender and a saved filter definition are things a team
-- shares and expects to persist and sync across devices, so neither
-- belongs only in localStorage (Phase 3 §15: "create the smallest
-- appropriate migration rather than storing watchlist state only in
-- localStorage").

-- A tender is watched by one specific user (not the whole agency at
-- once) but is still agency-owned data for RLS purposes — agency_id
-- is denormalised onto the row (rather than resolved via a join to
-- users on every policy check) purely so the standard agency-owned
-- RLS policy shape (§5 pattern 2, matching every other agency-owned
-- table) applies here unchanged.
create table watchlist_items (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  tender_id uuid not null references tenders(id) on delete cascade,
  notes text,
  created_at timestamptz not null default now(),
  -- One watchlist entry per (user, tender) — toggling watch on/off is
  -- an insert/delete of this one row, not a growing history.
  constraint watchlist_items_user_tender_unique unique (user_id, tender_id)
);

create index watchlist_items_agency_id_idx on watchlist_items (agency_id);
create index watchlist_items_user_id_idx on watchlist_items (user_id);
create index watchlist_items_tender_id_idx on watchlist_items (tender_id);

-- Saved filters are a named, reusable filter definition (Phase 3 §16
-- examples: "Print tenders closing within 14 days", "Western Cape +
-- Design + Advertising"). `filter` stores the same query-parameter
-- shape /api/tenders already accepts (§20) — re-applying a saved
-- filter is just replaying those parameters, so no separate filter
-- DSL/schema was invented (Phase 3 §16: "do not over-engineer this
-- feature").
create table saved_filters (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  filter jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint saved_filters_user_name_unique unique (user_id, name)
);

create index saved_filters_agency_id_idx on saved_filters (agency_id);
create index saved_filters_user_id_idx on saved_filters (user_id);

create trigger saved_filters_set_updated_at
  before update on saved_filters
  for each row execute function set_updated_at();

-- RLS: both tables follow the standard agency-owned shape (§5 pattern
-- 2), further narrowed to the owning user for watchlist_items/
-- saved_filters specifically — one user's watchlist or saved filters
-- are their own, not automatically shared with every agency colleague,
-- even though both are still scoped (and cascade-deleted) by agency.
alter table watchlist_items enable row level security;

create policy watchlist_items_select_own on watchlist_items
  for select to authenticated
  using (user_id = auth.uid() and agency_id = current_agency_id());

create policy watchlist_items_insert_own on watchlist_items
  for insert to authenticated
  with check (user_id = auth.uid() and agency_id = current_agency_id());

create policy watchlist_items_delete_own on watchlist_items
  for delete to authenticated
  using (user_id = auth.uid() and agency_id = current_agency_id());

alter table saved_filters enable row level security;

create policy saved_filters_select_own on saved_filters
  for select to authenticated
  using (user_id = auth.uid() and agency_id = current_agency_id());

create policy saved_filters_insert_own on saved_filters
  for insert to authenticated
  with check (user_id = auth.uid() and agency_id = current_agency_id());

create policy saved_filters_update_own on saved_filters
  for update to authenticated
  using (user_id = auth.uid() and agency_id = current_agency_id())
  with check (user_id = auth.uid() and agency_id = current_agency_id());

create policy saved_filters_delete_own on saved_filters
  for delete to authenticated
  using (user_id = auth.uid() and agency_id = current_agency_id());
