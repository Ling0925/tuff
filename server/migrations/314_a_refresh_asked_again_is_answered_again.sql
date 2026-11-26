/*
 * A refresh asked again is answered again, second of two files,
 * `312` added the column.
 *
 * A spent refresh token presented again matched no row and was a plain
 * 401. So a tab closed while its renewal was in flight left the server
 * holding a successor nobody had, and every other tab, and the next load,
 * signed out at their next renewal with the spent one; two tabs racing
 * did the same. Within ten seconds of its spending, a token presented
 * again is answered now with the session it was spent for — the same one,
 * so two racing tabs end on one session — when that session is still
 * live, and only to the browser it was spent from.
 *
 * And the spent rows, about a hundred a day per open browser, are swept.
 *
 * 1. Two indexes: a session's successor by `traded_from` (the column is
 *    312's), and a device's rows by when they were made, for the sweep.
 * 2. `auth_refresh_again(hash, device, within)`: the live successor of a
 *    token spent within `within` — never more than ten seconds, whatever
 *    the caller says — for the same person, the same workspace and the
 *    same device. The sign-in role's alone.
 * 3. `auth_end_session` ends the token's line too, so signing out with a
 *    token spent a moment ago ends the successor even when no device was
 *    written, and the grace has nothing to hand back. And it waits for a
 *    refresh of the same token in flight, so the session that refresh
 *    writes is ended with the rest rather than left behind it.
 * 4. `refresh_session_sweep(limit)`: the worker's, a week after nothing
 *    reads a row any more, never a device's newest row.
 *
 * The indexes are made inside the migration's transaction, which `create
 * index concurrently` cannot be. A plain `create index` takes SHARE on
 * `refresh_session`: reads go on — `auth_session_alive`, which every
 * request asks, among them — and writes wait while each reads the whole
 * table once, which is signing in, a refresh and signing out. The column
 * came in a file of its own (312) so that its ACCESS EXCLUSIVE, which
 * stops reads too, was let go before this file began. On a table much
 * larger than today's, build both by hand first with `create index
 * concurrently` and the same names and definitions; `if not exists` then
 * takes them as they are, and this file holds writes for no time at all.
 */

-- 1. Where a session was traded from, and a device's rows in order.
create index if not exists refresh_session_traded_from
  on refresh_session (traded_from) where traded_from is not null;

/* "Is there a newer row of this device", for the sweep. */
create index if not exists refresh_session_line
  on refresh_session (actor_id, device, created_at) where device is not null;

-- 2. The same answer, asked again within the window.
create function auth_refresh_again(p_hash text, p_device text, p_within interval)
returns table (session_id uuid, actor_id uuid, workspace_id uuid, token_hash text)
language sql stable security definer set search_path = public, pg_temp as $$
  select n.id, n.actor_id, n.workspace_id, n.token_hash
  from refresh_session s
  join refresh_session n on n.traded_from = s.id
  where s.token_hash = p_hash
    and s.revoked_at is not null
    and s.ended_at is null
    /* Ten seconds at most, and nothing for a window not said. */
    and s.revoked_at > now() - least(greatest(p_within, interval '0'), interval '10 seconds')
    and s.device is not distinct from p_device
    and n.actor_id = s.actor_id
    and n.workspace_id is not distinct from s.workspace_id
    and n.device is not distinct from s.device
    and n.revoked_at is null
    and n.ended_at is null
    and n.expires_at > now()
  limit 1
$$;
revoke execute on function auth_refresh_again(text, text, interval) from public, tracker_app;
grant execute on function auth_refresh_again(text, text, interval) to tracker_auth;

-- 3. Signing out ends the line the token is in, as well as its browser.
create or replace function auth_end_session(p_hash text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
  v_actor uuid;
  v_device text;
  v_family uuid;
begin
  /* `for update`: a refresh of this token in flight holds the row from its
     spend to its commit, with the session it is writing. Read without
     waiting, the update below ran on a snapshot from before that commit,
     ended the spent row and never saw its successor, which went on live
     after the sign-out. Waited for, the update's own snapshot is taken
     after the commit, and the successor is in the line it ends. */
  select id, actor_id, device, coalesce(family, id) into v_id, v_actor, v_device, v_family
  from refresh_session where token_hash = p_hash
  for update;
  if v_id is null then
    return;
  end if;
  update refresh_session set revoked_at = coalesce(revoked_at, now()), ended_at = now()
  where actor_id = v_actor and ended_at is null
    and (id = v_id
         or coalesce(family, id) = v_family
         or (v_device is not null and device = v_device));
end $$;

-- 4. The sweep.
create function refresh_session_sweep(p_limit int) returns int
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  n int;
begin
  delete from refresh_session
  where id in (
    select c.id from refresh_session c
    where (
        /* Traded: a week after it was spent. Ended while live
           (`revoked_at = ended_at`) waits for its end, for
           `auth_removed_by`. */
        (c.revoked_at is distinct from c.ended_at and c.revoked_at < now() - interval '7 days')
        /* Run out: a week after. */
        or c.expires_at < now() - interval '7 days'
      )
      /* Never a device's newest row: `auth_device_known` (114) asks for one. */
      and (c.device is null or exists (
        select 1 from refresh_session t
        where t.actor_id = c.actor_id and t.device = c.device
          and (t.created_at, t.id) > (c.created_at, c.id)))
    limit least(greatest(coalesce(p_limit, 0), 0), 5000)
    for update skip locked);
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function refresh_session_sweep(int) from public, tracker_app;
grant execute on function refresh_session_sweep(int) to tracker_worker;
