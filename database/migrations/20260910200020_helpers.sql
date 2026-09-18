-- Phase 2: shared helper function for `updated_at` maintenance.
-- Every table with an updated_at column gets this trigger attached at
-- creation time (docs/DATABASE.md §1: "maintained by a shared trigger,
-- not application code, so it can't be forgotten").
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Helper used by RLS policies: the calling user's agency_id, resolved
-- from the `users` table via the Supabase auth uid(). Returns null for
-- a user with no agency (e.g. mid-onboarding) rather than erroring, so
-- policies that compare against it simply match nothing.
--
-- Implemented in plpgsql rather than plain `sql` deliberately: a `sql`
-- language function has its body's relation references validated at
-- CREATE FUNCTION time, but `users` does not exist until a later
-- migration (20260910200060_agencies.sql). plpgsql defers name
-- resolution to first execution, so this can be created here, before
-- `users` exists, and still work correctly once it does.
create or replace function current_agency_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return (select agency_id from users where id = auth.uid());
end;
$$;
