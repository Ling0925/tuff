/*
 * A notification that leaves the browser.
 *
 * `004_notifications.sql` gave `notification` a `deliver_after` and a
 * `delivered_at` and said in its own comment that "delivery is about push and
 * email". Nothing has ever set `delivered_at`: the queue has been filling
 * since the day it was made, with nobody at the end of it — the same shape as
 * the webhook queue before `pnpm worker`. This is the missing end.
 *
 */

create table push_subscription (
  id uuid primary key,
  workspace_id uuid not null references workspace(id),
  actor_id uuid not null references actor(id),
  /* What the browser gave us. Unique, so a browser resubscribing replaces its
     row rather than growing a second one and sending twice. */
  endpoint text not null,
  /* The two the payload is encrypted with — RFC 8291. Public material: the
     private half never leaves the device. */
  p256dh text not null,
  auth text not null,
  /* What said it, for a list somebody can recognise their own machine in. */
  said text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz,
  deleted_at timestamptz
);

create unique index push_subscription_endpoint on push_subscription (endpoint)
  where deleted_at is null;
create index push_subscription_by_actor on push_subscription (workspace_id, actor_id)
  where deleted_at is null;

alter table push_subscription enable row level security;

/*
 * Your own devices and nobody else's — not even an owner's.
 *
 * A subscription is a handle on somebody's phone. There is no question the
 * product asks that needs one person to read another's, and the sender does
 * not ask as a person at all.
 */
create policy ps_read on push_subscription for select
  using (actor_id = current_actor());
create policy ps_write on push_subscription for insert
  with check (actor_id = current_actor());
create policy ps_update on push_subscription for update
  using (actor_id = current_actor());

/*
 * What is due, for the process that sends it.
 *
 * Across actors, so it is a definer function like `subscribers` and
 * `notify_prefs` — the sender has no actor and asking as nobody returns
 * nothing, which is a check that reads as working and does not. That exact
 * bug is why those two exist.
 *
 * A workspace at a time, for the same reason the webhook queue is: one
 * customer's dead endpoint must not starve everybody else's.
 */
create function due_notifications(p_limit int, p_workspace uuid default null)
returns table (
  id uuid,
  workspace_id uuid,
  actor_id uuid,
  reason notify_reason,
  object_type object_kind,
  object_id uuid
)
language sql volatile security definer set search_path = public as $$
  select n.id, n.workspace_id, n.actor_id, n.reason, n.object_type, n.object_id
  from notification n
  where n.delivered_at is null and n.deleted_at is null
    and n.deliver_after <= now()
    and (p_workspace is null or n.workspace_id = p_workspace)
    -- Only for somebody with a device on this workspace. Without this the
    -- queue is marked delivered for everybody who has never granted
    -- permission, and the day they do they start from empty.
    and exists (
      select 1 from push_subscription s
      where s.actor_id = n.actor_id and s.workspace_id = n.workspace_id
        and s.deleted_at is null
    )
  order by n.deliver_after
  limit p_limit
$$;

/* Where to send it, and what to encrypt it with. */
create function push_targets(p_workspace uuid, p_actor uuid)
returns table (id uuid, endpoint text, p256dh text, auth text)
language sql stable security definer set search_path = public as $$
  select s.id, s.endpoint, s.p256dh, s.auth
  from push_subscription s
  where s.workspace_id = p_workspace and s.actor_id = p_actor
    and s.deleted_at is null
$$;

/* Said and done with: the sending was attempted, which is the only thing
   anybody can observe. Whether a screen lit up is not ours to claim. */
create function notification_sent(p_id uuid) returns void
language sql volatile security definer set search_path = public as $$
  update notification set delivered_at = now(), updated_at = now() where id = p_id
$$;

/*
 * Gone is gone. A `404` or `410` is the browser saying the subscription no
 * longer exists, and unlike a webhook there is nothing on the other end to
 * come back — so it goes immediately rather than after a retry.
 */
create function push_subscription_gone(p_id uuid) returns void
language sql volatile security definer set search_path = public as $$
  update push_subscription set deleted_at = now(), updated_at = now() where id = p_id
$$;

/* The blanket grant in `002_rls.sql` covers the tables that existed then and
   nothing since, which is why every migration that adds one says so. */
grant select, insert, update on push_subscription to tracker_app;

grant execute on function due_notifications, push_targets, notification_sent,
  push_subscription_gone to tracker_app;

/*
 * What a notification is about, for the process that sends it.
 *
 * The sender has no actor, and row-level security hides the task, the room
 * and even the workspace's own name from nobody — so composing the message
 * from plain queries produced a notification about nothing, every time,
 * silently. That is the third time this has happened in this file's history
 * and the reason `subscribers` and `notify_prefs` exist.
 *
 * One function for all of it, because it is one question: what do I say and
 * where does it go.
 */
create function push_about(p_workspace uuid, p_type object_kind, p_id uuid)
returns table (
  workspace_slug text,
  title text,
  number int,
  project_slug text,
  project_key text,
  conversation uuid
)
language sql stable security definer set search_path = public as $$
  select
    w.slug::text,
    coalesce(o.title, c.name, 'A message'),
    o.number,
    p.slug::text,
    p.key,
    c.id
  from workspace w
  left join lateral (
    select t.title, t.number, t.project_id from task t
    where p_type = 'task' and t.id = p_id and t.deleted_at is null
    union all
    select s.title, s.number, s.project_id from post s
    where p_type = 'post' and s.id = p_id and s.deleted_at is null
    union all
    -- A file's name is its title. One column here rather than a second shape
    -- for the caller to know about.
    select f.name, f.number, f.project_id from file f
    where p_type = 'file' and f.id = p_id and f.deleted_at is null
  ) o on true
  left join project p on p.id = o.project_id and p.deleted_at is null
  left join conversation c
    on c.deleted_at is null
   and c.id = case
        when p_type = 'conversation' then p_id
        when p_type = 'message' then (select m.conversation_id from message m where m.id = p_id)
      end
  where w.id = p_workspace
$$;

grant execute on function push_about to tracker_app;
