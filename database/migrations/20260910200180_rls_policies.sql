-- Phase 2 §25: Row Level Security. RLS is enabled on every table with
-- no exceptions "to simplify development" (Phase 2 §25 explicitly
-- forbids that). Two shapes of policy cover the whole schema:
--
-- 1. Shared catalogue tables: public procurement facts, readable by
--    any authenticated user regardless of agency, writable only by
--    the privileged server-side service role (which bypasses RLS in
--    Supabase) — never directly by a browser client
--    (docs/SECURITY.md §3, docs/DATABASE.md §5).
-- 2. Agency-owned tables: isolated by agency_id = current_agency_id().
--
-- No INSERT/UPDATE/DELETE policy is created for the `authenticated`
-- role on shared catalogue tables — under RLS, the absence of a
-- policy for an operation denies it, so this is sufficient (and
-- verified by tests) rather than needing an explicit "deny" policy.

-- ---------------------------------------------------------------
-- Shared catalogue tables: read for any authenticated user.
-- ---------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'provinces', 'municipalities', 'services', 'service_subcategories',
    'tender_sources', 'tenders', 'tender_source_records',
    'tender_geographic_scope', 'tender_services', 'tender_documents',
    'tender_addenda', 'tender_requirements', 'tender_evaluation_criteria',
    'tender_evaluation_subcriteria', 'tender_briefings',
    'awards', 'competitors', 'competitor_activity'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy %I on %I for select to authenticated using (true)',
      t || '_select_authenticated', t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------
-- users: visible to self and to agency colleagues; writes are
-- server-side only (no authenticated-role write policy — role
-- changes must never be self-serviceable from the browser).
-- ---------------------------------------------------------------
alter table users enable row level security;

create policy users_select_self_or_colleagues on users
  for select to authenticated
  using (id = auth.uid() or agency_id = current_agency_id());

-- ---------------------------------------------------------------
-- agencies: visible/writable only to members of that agency.
-- (agencies.id IS the agency scope, not an agency_id column.)
-- ---------------------------------------------------------------
alter table agencies enable row level security;

create policy agencies_select_own on agencies
  for select to authenticated
  using (id = current_agency_id());

create policy agencies_update_own on agencies
  for update to authenticated
  using (id = current_agency_id())
  with check (id = current_agency_id());

-- ---------------------------------------------------------------
-- Agency-owned tables keyed directly by agency_id: full isolation.
-- ---------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'agency_team', 'agency_documents', 'agency_certificates',
    'agency_case_studies', 'agency_clients', 'agency_references',
    'agency_policies', 'agency_services', 'agency_evidence',
    'tender_scores', 'bid_projects', 'notifications'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy %I on %I for select to authenticated using (agency_id = current_agency_id())',
      t || '_select_own_agency', t
    );
    execute format(
      'create policy %I on %I for insert to authenticated with check (agency_id = current_agency_id())',
      t || '_insert_own_agency', t
    );
    execute format(
      'create policy %I on %I for update to authenticated using (agency_id = current_agency_id()) with check (agency_id = current_agency_id())',
      t || '_update_own_agency', t
    );
    execute format(
      'create policy %I on %I for delete to authenticated using (agency_id = current_agency_id())',
      t || '_delete_own_agency', t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------
-- tender_risks: agency_id is nullable (null = tender-general risk,
-- visible to all; set = specific to that agency's own assessment).
-- ---------------------------------------------------------------
alter table tender_risks enable row level security;

create policy tender_risks_select on tender_risks
  for select to authenticated
  using (agency_id is null or agency_id = current_agency_id());

create policy tender_risks_insert_own_agency on tender_risks
  for insert to authenticated
  with check (agency_id is null or agency_id = current_agency_id());

create policy tender_risks_update_own_agency on tender_risks
  for update to authenticated
  using (agency_id is null or agency_id = current_agency_id())
  with check (agency_id is null or agency_id = current_agency_id());

-- ---------------------------------------------------------------
-- Bid sub-tables: no agency_id column of their own — ownership is
-- resolved by joining up to bid_projects.agency_id.
-- ---------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'bid_sections', 'bid_requirements', 'bid_evidence',
    'bid_documents', 'bid_versions', 'bid_reviews', 'bid_submissions'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy %I on %I for select to authenticated using (exists (select 1 from bid_projects p where p.id = %I.bid_project_id and p.agency_id = current_agency_id()))',
      t || '_select_own_agency', t, t
    );
    execute format(
      'create policy %I on %I for insert to authenticated with check (exists (select 1 from bid_projects p where p.id = %I.bid_project_id and p.agency_id = current_agency_id()))',
      t || '_insert_own_agency', t, t
    );
    execute format(
      'create policy %I on %I for update to authenticated using (exists (select 1 from bid_projects p where p.id = %I.bid_project_id and p.agency_id = current_agency_id())) with check (exists (select 1 from bid_projects p where p.id = %I.bid_project_id and p.agency_id = current_agency_id()))',
      t || '_update_own_agency', t, t, t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------
-- audit_logs: append-only even for the owning agency (no update or
-- delete policy for `authenticated` at all — see docs/SECURITY.md §9).
-- Visible to ADMIN users of the entry's own agency, plus any
-- agency-null (system-wide) entries.
-- ---------------------------------------------------------------
alter table audit_logs enable row level security;

create policy audit_logs_select_admin_own_agency on audit_logs
  for select to authenticated
  using (
    (agency_id is null or agency_id = current_agency_id())
    and exists (select 1 from users u where u.id = auth.uid() and u.role = 'ADMIN')
  );

-- Note: no insert policy is created for `authenticated` — audit rows
-- are written exclusively by the server-side service role, which
-- bypasses RLS in Supabase, so application code can never forge or
-- omit an audit entry for its own actions.
