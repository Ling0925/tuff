/*
 * A device with no session hears nothing,
 * .
 *
 * 139 took a device's rows away when its last session was *ended*: signing
 * out, ending it from Account, every other device. Three ways a device stops
 * being signed in end nothing, and its rows stayed, written to for good:
 *
 * - The session ran out. Thirty days unopened and the refresh token is
 *   refused, but `ended_at` was never set, so the trigger never ran.
 * - The session was revoked rather than ended — a claimed address, a reset
 *   through a provider (087, 106) set `revoked_at` alone.
 * - The device lost its session without telling anybody: a Keychain that did
 *   not keep it, a reinstall, a build signed another way. The Mac app opened
 *   on the sign-in screen and went on drawing the account's pushes, which
 *   is what we saw.
 *
 * The last the server cannot see until the session runs out; the app
 * unregisters itself from Apple's service when it opens with no session,
 * and Apple's refusal then takes the row. The first two it can: a row is
 * written to only while its device has a session that is live — not ended,
 * not run out, and not spent unless a moment ago (a refresh spends one
 * session and writes the next, and a push sent between the two is not a
 * reason to forget the phone). The clear-out takes the rest.
 *
 * Rows with no device are browsers registered before 139, and go only as
 * they did. An app's row with no device is taken now: the apps register
 * again on their next signed-in start, this time under the device.
 */

/* Whether the device a row names may still be written to. */
create or replace function push_device_live(p_actor uuid, p_device text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_device is null or exists (
    select 1 from refresh_session s
    where s.actor_id = p_actor and s.device = p_device
      and s.ended_at is null and s.expires_at > now()
      and (s.revoked_at is null or s.revoked_at > now() - interval '1 minute')
  )
$$;
revoke execute on function push_device_live(uuid, text) from public;

create or replace function push_targets(p_workspace uuid, p_actor uuid)
returns table (id uuid, kind text, endpoint text, p256dh text, auth text)
language sql stable security definer set search_path = public as $$
  select s.id, s.kind, s.endpoint, s.p256dh, s.auth
  from push_subscription s
  where s.workspace_id = p_workspace and s.actor_id = p_actor
    and s.deleted_at is null
    and push_device_live(s.actor_id, s.device)
$$;

create or replace function push_recounts(p_limit int)
returns table (id uuid, workspace_id uuid, actor_id uuid, endpoint text, told_unread int)
language sql volatile security definer set search_path = public as $$
  update push_subscription s set recount_at = null
  where s.id in (
    select d.id from push_subscription d
    where d.recount_at is not null and d.deleted_at is null and d.kind = 'apns'
      and push_device_live(d.actor_id, d.device)
    order by d.recount_at
    limit p_limit
    for update skip locked)
  returning s.id, s.workspace_id, s.actor_id, s.endpoint, s.told_unread
$$;

/* The clear-out: every row whose device is signed in nowhere, gone. */
create or replace function push_sweep() returns int
language plpgsql volatile security definer set search_path = public as $$
declare n int;
begin
  delete from push_subscription
  where device is not null and not push_device_live(actor_id, device);
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function push_sweep() from public, tracker_app;
grant execute on function push_sweep() to tracker_worker;

delete from push_subscription where kind in ('apns', 'fcm') and device is null;
