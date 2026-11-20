/*
 * The second factor, turned on by the account's holder and nobody else
 * holding a session; and "sign out other devices" keeping this session,
 * not whatever says it is this browser, the second factor spec,
 */

/* ------------------------------------------------ when the factor went on

   A reset by mail takes off a factor turned on in the last seven days: one
   turned on by somebody who had learned the password stood between the
   owner and the account the reset gave back. Null for factors turned on
   before this column, which a reset keeps as it did. */
alter table app_user add column if not exists totp_enabled_at timestamptz;

/* Turned on only when it was off, and says whether it was: a factor already
   on is not turned on again, so enabling never deals new recovery codes
   over one that is on. */
drop function if exists auth_totp_enable(uuid);
create function auth_totp_enable(p_actor uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update app_user set totp_enabled = true, totp_enabled_at = now(), updated_at = now()
  where actor_id = p_actor and totp_secret_enc is not null and not totp_enabled;
  return found;
end $$;
grant execute on function auth_totp_enable(uuid) to tracker_app;

create or replace function auth_totp_disable(p_actor uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update app_user set totp_enabled = false, totp_secret_enc = null, totp_enabled_at = null, updated_at = now()
  where actor_id = p_actor;
  -- The codes go with it. Leaving them is leaving a way in that the person
  -- believes they have turned off.
  delete from recovery_code where actor_id = p_actor;
end $$;

/* Migration 212's, and a factor from this week goes with the reset. */
create or replace function auth_set_password(p_actor uuid, p_hash text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_had boolean;
  v_unproved boolean;
  v_fresh boolean;
begin
  select password_hash is not null, email_verified_at is null or email_by_hand,
         coalesce(totp_enabled and totp_enabled_at > now() - interval '7 days', false)
  into v_had, v_unproved, v_fresh
  from app_user where actor_id = p_actor;
  update app_user
  set password_hash = p_hash, email_verified_at = coalesce(email_verified_at, now()),
      email_by_hand = false, updated_at = now()
  where actor_id = p_actor;
  update refresh_session set revoked_at = coalesce(revoked_at, now()), ended_at = now()
  where actor_id = p_actor and ended_at is null;
  if v_had or v_unproved then
    update api_token set revoked_at = now() where actor_id = p_actor and revoked_at is null;
    delete from push_subscription where actor_id = p_actor;
  end if;
  if v_unproved or v_fresh then
    update app_user set totp_enabled = false, totp_secret_enc = null, totp_enabled_at = null, updated_at = now()
    where actor_id = p_actor;
    delete from recovery_code where actor_id = p_actor;
  end if;
  if v_unproved then
    delete from auth_identity where actor_id = p_actor;
    delete from github_person where actor_id = p_actor;
    update auth_ticket set used_at = now() where actor_id = p_actor and used_at is null;
  end if;
  insert into security_event (id, workspace_id, actor_id, kind)
  select gen_random_uuid(), m.workspace_id, p_actor, 'password_reset'
  from membership m
  where m.actor_id = p_actor and m.deleted_at is null and m.joined_at is not null;
end $$;

/* ------------------------------------------------- a session's own line

   `x-device` is what the client says, and "sign out other devices" kept
   every session that said the same: a copy of the browser's storage
   survived it, and a password change. A session now carries the line it
   descends from — the sign-in its refresh token was traded from, and
   nothing else (a copied access token is not a way in) — and that line,
   set by the server, is what is kept. No default and no rewrite: a row
   without one is its own line (`coalesce(family, id)` wherever it is read). */
alter table refresh_session add column if not exists family uuid;

/* The line a session belongs to, for the one made from it. */
create or replace function auth_family_of(p_actor uuid, p_sid uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(family, id) from refresh_session where id = p_sid and actor_id = p_actor
$$;
grant execute on function auth_family_of(uuid, uuid) to tracker_app;

/* Every other session out; the one asking, and its own line, kept. */
create or replace function auth_revoke_others(p_actor uuid, p_keep uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_family uuid;
  n int;
begin
  select coalesce(family, id) into v_family from refresh_session where id = p_keep and actor_id = p_actor;
  /* Counted as the list counts them: a browser still signed in, not the
     traded tokens behind it that are ended along with it. */
  select count(distinct coalesce(device, family::text, id::text))::int into n from refresh_session
  where actor_id = p_actor and id <> p_keep and revoked_at is null and expires_at > now()
    and coalesce(family, id) is distinct from v_family;
  update refresh_session set revoked_at = coalesce(revoked_at, now()), ended_at = now()
  where actor_id = p_actor and id <> p_keep and ended_at is null
    and (v_family is null or coalesce(family, id) <> v_family);
  return n;
end $$;
