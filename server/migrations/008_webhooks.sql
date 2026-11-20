-- Events out.
--
-- Signed, and with replay protection: a receiver has to be able to tell our
-- delivery from somebody replaying one they captured, and a shared secret in a
-- header does neither on its own.
create table webhook (
  id uuid primary key,
  workspace_id uuid not null references workspace(id),
  url text not null,
  /** Which events it wants. Empty means everything. */
  events text[] not null default '{}',
  secret_enc text not null,
  enabled boolean not null default true,
  created_by uuid not null references actor(id),
  last_status int,
  last_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- The queue. Delivery is retried, and a retry must not become a second event
-- at the receiver, so the id travels with it and is the thing they deduplicate
-- on.
create table webhook_delivery (
  id uuid primary key,
  workspace_id uuid not null references workspace(id),
  webhook_id uuid not null references webhook(id),
  event text not null,
  payload jsonb not null,
  attempts int not null default 0,
  deliver_after timestamptz not null default now(),
  delivered_at timestamptz,
  last_status int,
  last_error text,
  created_at timestamptz not null default now()
);
create index webhook_delivery_pending on webhook_delivery (deliver_after)
  where delivered_at is null;

alter table webhook enable row level security;
alter table webhook_delivery enable row level security;
grant select, insert, update on webhook to tracker_app;
grant select, insert, update on webhook_delivery to tracker_app;

create policy wh_read on webhook for select
  using (role_in(workspace_id) in ('owner', 'admin'));
create policy wh_write on webhook for insert
  with check (role_in(workspace_id) in ('owner', 'admin'));
create policy wh_update on webhook for update
  using (role_in(workspace_id) in ('owner', 'admin'));

create policy whd_read on webhook_delivery for select
  using (role_in(workspace_id) in ('owner', 'admin'));
create policy whd_write on webhook_delivery for insert with check (is_member(workspace_id));
create policy whd_update on webhook_delivery for update using (is_member(workspace_id));

-- The secret is never selectable, the same way a password hash is not.
revoke select on webhook from tracker_app;
grant select (id, workspace_id, url, events, enabled, created_by, last_status,
              last_at, created_at, updated_at, deleted_at)
  on webhook to tracker_app;

create trigger touch before update on webhook
  for each row execute function touch_updated_at();
