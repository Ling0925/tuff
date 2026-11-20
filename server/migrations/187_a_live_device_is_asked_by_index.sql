/*
 * What the review of 186 found.
 *
 * `push_device_live` read `refresh_session` from end to end: one `exists`
 * with an `or` over `revoked_at` matched no index, and the table is never
 * cleared (`auth_device_known`, 114, reads a device's old sessions to tell
 * its owner from a guesser, so old rows are history somebody relies on).
 * Six milliseconds a row at 45 000 sessions, once per device per push.
 *
 * Two questions instead, each with an index:
 * - a session not spent, not ended, not run out — `refresh_session_device`,
 *   (actor_id, device) where revoked_at is null (109);
 * - one spent in the last minute, its successor not written yet — the index
 *   below, (actor_id, device, revoked_at) where ended_at is null.
 *
 * Built inside the migration's transaction, so not `concurrently`: it holds
 * writes to `refresh_session` while it builds, which on today's table is a
 * moment. A table grown much larger would want it built by hand first.
 *
 * And an app's row with no device is never live: both apps send `x-device`
 * on every request, so a phone registered without one has no session to
 * follow and would be written to for good. Registering one is refused now
 * (`POST /api/push`, 400); 186 took the ones there were.
 */
create index if not exists refresh_session_device_spent
  on refresh_session (actor_id, device, revoked_at) where ended_at is null;

create or replace function push_device_live(p_actor uuid, p_device text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_device is null
    or exists (
      select 1 from refresh_session s
      where s.actor_id = p_actor and s.device = p_device
        and s.revoked_at is null and s.ended_at is null and s.expires_at > now())
    or exists (
      select 1 from refresh_session s
      where s.actor_id = p_actor and s.device = p_device
        and s.ended_at is null and s.expires_at > now()
        and s.revoked_at > now() - interval '1 minute')
$$;

/* A row may be written to: a browser from before 139 with no device, as it
   was; anything else only while its device has a live session. */
create or replace function push_row_live(p_kind text, p_actor uuid, p_device text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when p_device is null then p_kind = 'web'
    else push_device_live(p_actor, p_device)
  end
$$;
revoke execute on function push_row_live(text, uuid, text) from public;

create or replace function push_targets(p_workspace uuid, p_actor uuid)
returns table (id uuid, kind text, endpoint text, p256dh text, auth text)
language sql stable security definer set search_path = public as $$
  select s.id, s.kind, s.endpoint, s.p256dh, s.auth
  from push_subscription s
  where s.workspace_id = p_workspace and s.actor_id = p_actor
    and s.deleted_at is null
    and push_row_live(s.kind, s.actor_id, s.device)
$$;

create or replace function push_recounts(p_limit int)
returns table (id uuid, workspace_id uuid, actor_id uuid, endpoint text, told_unread int)
language sql volatile security definer set search_path = public as $$
  update push_subscription s set recount_at = null
  where s.id in (
    select d.id from push_subscription d
    where d.recount_at is not null and d.deleted_at is null and d.kind = 'apns'
      and push_row_live(d.kind, d.actor_id, d.device)
    order by d.recount_at
    limit p_limit
    for update skip locked)
  returning s.id, s.workspace_id, s.actor_id, s.endpoint, s.told_unread
$$;

create or replace function push_sweep() returns int
language plpgsql volatile security definer set search_path = public as $$
declare n int;
begin
  delete from push_subscription
  where not push_row_live(kind, actor_id, device);
  get diagnostics n = row_count;
  return n;
end $$;
