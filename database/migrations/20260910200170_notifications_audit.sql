-- Phase 2 §21: notifications.
create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  agency_id uuid references agencies(id),
  event_type notification_event_type not null,
  channel notification_channel not null default 'IN_APP',
  payload jsonb,
  related_tender_id uuid references tenders(id),
  related_bid_project_id uuid references bid_projects(id),
  read_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_id_idx on notifications (user_id);
create index notifications_agency_id_idx on notifications (agency_id);
create index notifications_unread_idx on notifications (user_id) where read_at is null;

-- Phase 2 §22: audit log. Append-only (enforced by revoking
-- UPDATE/DELETE from the application role in the RLS migration, not
-- merely by convention — docs/SECURITY.md §9). Every AI-driven change
-- that lands in a procurement-relevant table is auditable via
-- actor_type = 'AGENT'.
create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  -- Nullable: not every audited action is scoped to one agency (e.g.
  -- a source health change touches shared catalogue data). Added
  -- beyond the literal Phase 2 §22 field list so RLS can scope
  -- visibility of agency-relevant entries without a join — logged in
  -- docs/DECISIONS.md.
  agency_id uuid references agencies(id),
  actor_id uuid,
  actor_type actor_type not null default 'USER',
  agent_name text,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  old_value jsonb,
  new_value jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now(),
  constraint audit_logs_agent_name_required_for_agent
    check (actor_type <> 'AGENT' or agent_name is not null)
);

create index audit_logs_entity_idx on audit_logs (entity_type, entity_id);
create index audit_logs_agency_id_idx on audit_logs (agency_id) where agency_id is not null;
create index audit_logs_actor_id_idx on audit_logs (actor_id) where actor_id is not null;
create index audit_logs_created_at_idx on audit_logs (created_at desc);
