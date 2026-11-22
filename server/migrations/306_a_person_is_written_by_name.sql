/*
 * The application writes six of a person's settings and nothing else of
 * `app_user` directly, the security audit spec, the
 * night audit's review ("Was open: the application role could write any
 * column of `app_user`"), and `docs/api.md`, "Getting in is written by
 * definers".
 *
 * **What this does not do.** It does not stop SQL run as the application
 * from taking an account over. The definer functions `tracker_app` may
 * execute — `auth_set_password(p_actor, …)`, `auth_ticket_make` minting a
 * reset ticket with a hash of the caller's choosing, `auth_email_change`,
 * `auth_totp_disable`, `auth_recovery_replace`, `auth_identity_link`,
 * `register_owner(…, p_confirmed => true)`, `accept_invite` and the rest
 * listed in `app-user-rights.test.ts` — trust the actor id they are
 * handed, and `current_actor()` is `current_setting('app.actor_id')`,
 * which the application role sets for itself (`set_config`). An injection
 * that can call those can still set anybody's password. The boundary that
 * would stop it is a role of its own for the credential and session
 * definers (`tracker_auth`, its own pool, EXECUTE taken from
 * `tracker_app`), and definers that consume a proof themselves rather
 * than trust a caller's id. That is a follow-up, not this.
 *
 * What this does:
 *
 * 1. **No direct write to a sign-in column.** Migrations 001 and 002
 *    granted `tracker_app` INSERT and UPDATE on the whole of `app_user`,
 *    and `u_write` let an insert through `with check (true)` with no
 *    actor set: one plain `update app_user set password_hash = …` took an
 *    account. Every write the server makes to a sign-in column already
 *    went through a definer function, so the table-wide grant goes, and
 *    the definers become the single list to audit. What the server writes
 *    directly is a person's own settings, as that person, through
 *    `u_update`:
 *
 *    - `notify_chat`, `email_digest`, `quiet_from`, `quiet_to`, `timezone`
 *      — `PATCH /api/inbox/settings` (`http/inbox.ts`);
 *    - `language` — `PATCH /api/me` (`http/routes.ts`).
 *
 *    Those six are granted by name. `updated_at` is set by the `touch`
 *    trigger, which needs no grant of its own. A REVOKE on a table takes
 *    the column privileges of that kind with it (005, 128 and 142 granted
 *    these six by column), so they are granted again after it. The
 *    worker's role and PUBLIC hold nothing on the table and are told so.
 *    `u_write` goes: with no INSERT left it lets nothing in, but a policy
 *    that says `with check (true)` is one grant away from letting anybody
 *    in again. The definers run as the tables' owner, which row-level
 *    security does not hold (the table is not FORCE), so they need none.
 *
 * 2. **A time zone the database knows.** A zone it does not know made
 *    every notification to its owner fail inside the transaction of
 *    whoever was writing to them (`http/inbox.ts` checks it; SQL run as
 *    the app would not). A trigger refuses one on insert and on change,
 *    asked of `pg_timezone_names` as the route asks.
 *
 * 3. **A token is revoked and nothing else.** The application updates
 *    `api_token` only to revoke it (`revokeApiToken`, `auth/flows.ts`);
 *    last use, OAuth pairs, refresh hashes and the clear-outs are all
 *    definer functions. UPDATE was granted on every column — `actor_id`
 *    and `token_hash` among them — and is `revoked_at` alone now; and a
 *    revoked token stays revoked, since revoking has no inverse.
 *
 * 4. **A session is inserted for the actor of its transaction.**
 *    `sess_write` was `with check (true)`, so SQL run as the app could
 *    write a refresh session for anybody with no actor set. It asks
 *    `actor_id = current_actor()` now, and `startSession` and
 *    `startNowhereSession` insert as the person signing in. Weak while the
 *    actor setting is the app's to set (above) — it is the same check
 *    every other insert policy makes, and no longer an open door.
 *
 * Each grant statement holds whatever the grants were before:
 * production's could not be read from here.
 */

revoke insert, update, delete, truncate, references, trigger on app_user from tracker_app;
revoke all on app_user from tracker_worker;
revoke all on app_user from public;

grant update (notify_chat, email_digest, quiet_from, quiet_to, timezone, language)
  on app_user to tracker_app;

drop policy if exists u_write on app_user;

-- 2. The zone.
create or replace function app_user_zone_known() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from pg_timezone_names where name = new.timezone) then
    raise exception 'unknown time zone: %', new.timezone using errcode = '22023';
  end if;
  return new;
end $$;
revoke all on function app_user_zone_known() from public;

drop trigger if exists app_user_zone_known_insert on app_user;
create trigger app_user_zone_known_insert before insert on app_user
  for each row when (new.timezone <> 'UTC') execute function app_user_zone_known();
drop trigger if exists app_user_zone_known_update on app_user;
create trigger app_user_zone_known_update before update of timezone on app_user
  for each row when (new.timezone is distinct from old.timezone) execute function app_user_zone_known();

-- 3. The token.
revoke update on api_token from tracker_app;
grant update (revoked_at) on api_token to tracker_app;

create or replace function api_token_stays_revoked() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'a revoked token stays revoked' using errcode = '42501';
end $$;
revoke all on function api_token_stays_revoked() from public;

drop trigger if exists api_token_stays_revoked on api_token;
create trigger api_token_stays_revoked before update of revoked_at on api_token
  for each row when (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at)
  execute function api_token_stays_revoked();

-- 4. The session.
drop policy if exists sess_write on refresh_session;
create policy sess_write on refresh_session for insert with check (actor_id = current_actor());
