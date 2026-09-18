-- Phase 19 gap-closing §15 — extend the existing (Phase 2) notifications
-- table into a real, wired, user-facing notification system. This is
-- additive: no existing column, row, or RLS policy is removed. The
-- table was previously defined (20260910200170_notifications_audit.sql)
-- but never referenced by any application code — confirmed by
-- repo-wide grep before writing this migration. This migration and the
-- application code in lib/notifications/* make it real.
--
-- Distinct from audit_logs: audit_logs is an append-only, admin-facing
-- system-of-record for who-changed-what (never read/dismissed, no user
-- scoping beyond agency). notifications is a user-facing inbox: it is
-- read, dismissed, deduplicated, and always links back to one concrete
-- entity a user can navigate to.

-- The spec's 10 named triggers, several of which have no equivalent in
-- the Phase 2 enum. NEW_RELEVANT_TENDER already exists. Values are
-- added one per statement inside this migration's own transaction and
-- are not referenced until a later statement/transaction, which is
-- safe for `alter type ... add value` (see docs/DECISIONS.md).
alter type notification_event_type add value if not exists 'TENDER_UPDATED';
alter type notification_event_type add value if not exists 'ADDENDUM_DETECTED';
alter type notification_event_type add value if not exists 'BRIEFING_DEADLINE';
alter type notification_event_type add value if not exists 'TENDER_DEADLINE';
alter type notification_event_type add value if not exists 'DOCUMENT_PROCESSING_FAILED';
alter type notification_event_type add value if not exists 'OUTCOME_DETECTED';
alter type notification_event_type add value if not exists 'OUTCOME_CONFLICT';
alter type notification_event_type add value if not exists 'OUTCOME_REQUIRES_REVIEW';
alter type notification_event_type add value if not exists 'SUBMISSION_OUTCOME_UNKNOWN';

-- entity_type/entity_id: a generic pointer to "the underlying entity"
-- the spec requires every notification to link to (a tender, a
-- document, an outcome, a conflict, an addendum, a bid project...) —
-- more general than the two narrow existing FKs
-- (related_tender_id/related_bid_project_id, the latter pointing at
-- the unused legacy bid_projects table), which are kept as-is for
-- backward compatibility but no longer the only way to link an entity.
alter table notifications add column if not exists entity_type text;
alter table notifications add column if not exists entity_id uuid;

-- The legacy related_bid_project_id FK points at bid_projects (Phase 2,
-- superseded by bid_strategy_projects in Phase 12+ and confirmed
-- unused by any current write path). A second, correctly-targeted
-- column is added rather than repointing the old FK, so no existing
-- row/constraint is disturbed.
alter table notifications add column if not exists bid_strategy_project_id uuid references bid_strategy_projects(id);

-- Dismiss is distinct from read: a user can mark something read
-- without hiding it from the inbox, and dismiss to remove it from the
-- active list entirely (spec §15: "dismissible").
alter table notifications add column if not exists dismissed_at timestamptz;

-- Deduplication key: e.g. "OUTCOME_CONFLICT:outcome_conflict:<id>" or
-- "TENDER_DEADLINE:tender:<id>:2026-09-20". A repeat detection of the
-- same fact (re-running the on-demand check, or a route firing twice)
-- must never create a second notification row for the same
-- user-facing fact (spec §15: "deduplicated"). NULL is allowed (and
-- non-unique) for any notification that predates this column or that
-- has no natural dedup key.
alter table notifications add column if not exists dedup_key text;
create unique index if not exists notifications_dedup_key_unique on notifications (dedup_key) where dedup_key is not null;

create index if not exists notifications_entity_idx on notifications (entity_type, entity_id) where entity_type is not null;
create index if not exists notifications_active_idx on notifications (agency_id, user_id) where dismissed_at is null;

comment on column notifications.entity_type is 'Phase 19 gap-closing: generic entity link (e.g. tender, tender_document, tender_outcome, outcome_conflict, tender_addendum, bid_strategy_project) so every notification can navigate to its underlying fact (spec §15).';
comment on column notifications.dedup_key is 'Phase 19 gap-closing: unique-when-present key preventing duplicate notifications for the same detected fact (spec §15 "deduplicated").';

-- ---------------------------------------------------------------
-- Security-audit finding (spec §22, Phase 19 gap-closing): the
-- original Phase 2 RLS policy for `notifications` (20260910200180)
-- scopes only by agency_id, granting every authenticated member of an
-- agency direct-table select/update/delete over every OTHER member's
-- notification rows via a direct Supabase REST/JS call bearing their
-- own JWT (bypassing the API layer's per-user filtering). For a
-- user-facing inbox this is a real cross-user (not cross-agency)
-- exposure inside the same agency, so it is tightened here rather
-- than only documented: a notification is visible/writable only to
-- the agency (for the still-supported agency-wide notification,
-- user_id null) or to the specific user it names.
drop policy if exists notifications_select_own_agency on notifications;
drop policy if exists notifications_insert_own_agency on notifications;
drop policy if exists notifications_update_own_agency on notifications;
drop policy if exists notifications_delete_own_agency on notifications;

create policy notifications_select_own on notifications
  for select to authenticated
  using (agency_id = current_agency_id() and (user_id is null or user_id = auth.uid()));

-- All application inserts happen via the service-role client (see
-- lib/notifications/supabaseNotificationStore.ts), which bypasses RLS
-- entirely, exactly like every other write path in this system
-- (docs/SECURITY.md §3) — so no authenticated-role INSERT policy is
-- recreated here (its absence denies direct-from-browser inserts,
-- verified by database/src/__tests__/notifications.test.ts).
create policy notifications_update_own on notifications
  for update to authenticated
  using (agency_id = current_agency_id() and (user_id is null or user_id = auth.uid()))
  with check (agency_id = current_agency_id() and (user_id is null or user_id = auth.uid()));

create policy notifications_delete_own on notifications
  for delete to authenticated
  using (agency_id = current_agency_id() and (user_id is null or user_id = auth.uid()));

-- ---------------------------------------------------------------
-- Production Source Operations evidence (spec §7, Phase 19
-- gap-closing): every field spec §7 names was checked against
-- tender_sources/tender_source_scans/tender_source_errors (Phase 4,
-- 20260911100000_source_registry.sql) —
--   adapter -> adapter_key/adapter_state; enabled/disabled ->
--   active/adapter_state; last scan -> last_scan_at; next scan ->
--   computed in apps/api/src/lib/sourceSchedule.ts from
--   last_scan_at + scan_frequency (deliberately not a stored column,
--   documented in that migration, to avoid a second place it can
--   drift); scan duration -> completed_at - started_at per scan;
--   records discovered/imported -> records_discovered/
--   records_processed; failures -> records_failed/error_count;
--   last successful scan -> last_success_at; last error ->
--   last_failure_at + tender_source_errors.message; health status ->
--   health_status.
--
-- Two fields named in spec §7 were genuinely missing rather than
-- present under a different name: "duplicates" (records discovered
-- that were already-known, not new) and "retry count" (how many times
-- a scan attempt was retried before its terminal status). Added here
-- rather than only documented, since `tender_source_scans` is still
-- empty in every environment (no live scanning exists yet — Phase 4/5
-- binding constraint), so this is a zero-risk additive column.
alter table tender_source_scans add column if not exists records_duplicate integer not null default 0;
alter table tender_source_scans add column if not exists retry_count integer not null default 0;
alter table tender_source_scans add constraint tender_source_scans_records_duplicate_non_negative check (records_duplicate >= 0);
alter table tender_source_scans add constraint tender_source_scans_retry_count_non_negative check (retry_count >= 0);

comment on column tender_source_scans.records_duplicate is 'Phase 19 gap-closing (spec §7): records discovered in this scan that were already-known (not newly imported/updated).';
comment on column tender_source_scans.retry_count is 'Phase 19 gap-closing (spec §7): number of retry attempts this scan run went through before reaching its terminal status.';
