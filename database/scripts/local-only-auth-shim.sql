-- LOCAL TESTING ONLY — never applied to a real Supabase project.
--
-- A real Supabase project already provides the `auth` schema,
-- `auth.users` table, `auth.uid()` function, and the `authenticated`
-- / `service_role` Postgres roles. This file recreates the minimal
-- subset of that surface so the versioned migrations under
-- database/migrations/ — which are written to be portable, unmodified,
-- to a real Supabase project — can be applied and exercised against a
-- plain local Postgres instance for Phase 2 development and testing
-- (see database/README.md).
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text
);

-- Mirrors Supabase's auth.uid(): reads the caller's id from a
-- session-local GUC that a test sets via `set local request.jwt.claim.sub`.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

-- Supabase's two request-time roles. `authenticated` is subject to
-- RLS; `service_role` bypasses it (BYPASSRLS), exactly as on a real
-- Supabase project, so tests can verify both the restricted and the
-- privileged server-side path.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

grant usage on schema public, auth to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant usage on all sequences in schema public to authenticated, service_role;
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated, service_role;
