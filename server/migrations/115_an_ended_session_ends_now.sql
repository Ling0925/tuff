/*
 * A session somebody ended stops now, not in fifteen minutes.
 *
 * Signing out, ending a device from Account, resetting a password: each
 * revoked the refresh token and nothing else, and the access token beside
 * it — a signed fifteen-minute pass no request ever looked up — went on
 * working until it ran out. Fifteen minutes was long enough to make a
 * ninety-day API token or open a new session through another workspace,
 * which made a stolen session survive the reset meant to end it.
 *
 * Every access token names the session it came from (`sid`), so every
 * request now asks whether that session was ended. Ended is not the same
 * as revoked: a refresh token is revoked every time it is traded for the
 * next one, and the access tokens other tabs still hold from before the
 * trade must keep working. So ending is its own mark, put on the session
 * and on every other one of the same browser, traded or not.
 */
alter table refresh_session add column ended_at timestamptz;

/* Whether the session an access token came from has not been ended. */
create function auth_session_alive(p_sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from refresh_session where id = p_sid and ended_at is null)
$$;
grant execute on function auth_session_alive(uuid) to tracker_app;

/* And an API token, asked again by a socket that has been open a while. */
create function auth_token_alive(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from api_token
    where id = p_id and revoked_at is null and deleted_at is null and expires_at > now())
$$;
grant execute on function auth_token_alive(uuid) to tracker_app;

/* Signing out: the browser the refresh token belongs to, every session of it. */
create function auth_end_session(p_hash text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_actor uuid;
  v_device text;
begin
  select id, actor_id, device into v_id, v_actor, v_device
  from refresh_session where token_hash = p_hash;
  if v_id is null then
    return;
  end if;
  update refresh_session set revoked_at = coalesce(revoked_at, now()), ended_at = now()
  where actor_id = v_actor and ended_at is null
    and (id = v_id or (v_device is not null and device = v_device));
end $$;
grant execute on function auth_end_session(text) to tracker_app;

/* One line out from Account: every session of the browser that line is. */
create or replace function auth_revoke_session(p_actor uuid, p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_device text;
  hit int;
begin
  select device into v_device from refresh_session where id = p_id and actor_id = p_actor;
  with ended as (
    update refresh_session set revoked_at = coalesce(revoked_at, now()), ended_at = now()
    where actor_id = p_actor and ended_at is null
      and (id = p_id or (v_device is not null and device = v_device))
    returning revoked_at
  )
  select count(*) into hit from ended;
  return hit > 0;
end $$;

/* Every other browser out; every session of the one asking kept. */
create or replace function auth_revoke_others(p_actor uuid, p_keep uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_device text;
  n int;
begin
  select device into v_device from refresh_session where id = p_keep and actor_id = p_actor;
  /* Counted as the list counts them: a browser still signed in, not the
     traded tokens behind it that are ended along with it. */
  select count(distinct coalesce(device, id::text))::int into n from refresh_session
  where actor_id = p_actor and id <> p_keep and revoked_at is null and expires_at > now()
    and (v_device is null or device is distinct from v_device);
  update refresh_session set revoked_at = coalesce(revoked_at, now()), ended_at = now()
  where actor_id = p_actor and id <> p_keep and ended_at is null
    and (v_device is null or device is distinct from v_device);
  return n;
end $$;

/*
 * A password set by the link a forgotten one sends.
 *
 * Every session ends, as it did, and now at once. When the account had a
 * password already this is somebody taking it back, so the tokens made for
 * tools go too — a token made while somebody else was in the account would
 * otherwise outlive everything the reset was for. A first password, for an
 * account made through a provider, leaves them. The link came to the
 * address, so the address is confirmed; the security log of every
 * workspace has a line for it.
 */
create or replace function auth_set_password(p_actor uuid, p_hash text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_had boolean;
begin
  select password_hash is not null into v_had from app_user where actor_id = p_actor;
  update app_user
  set password_hash = p_hash, email_verified_at = coalesce(email_verified_at, now()), updated_at = now()
  where actor_id = p_actor;
  update refresh_session set revoked_at = coalesce(revoked_at, now()), ended_at = now()
  where actor_id = p_actor and ended_at is null;
  if v_had then
    update api_token set revoked_at = now() where actor_id = p_actor and revoked_at is null;
  end if;
  insert into security_event (id, workspace_id, actor_id, kind)
  select gen_random_uuid(), m.workspace_id, p_actor, 'password_reset'
  from membership m
  where m.actor_id = p_actor and m.deleted_at is null and m.joined_at is not null;
end $$;

/* A provider vouches for an unconfirmed address: whoever made the account
   loses it, and every session of theirs ends now. */
create or replace function auth_claim_email(p_actor uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from app_user where actor_id = p_actor and email_verified_at is null) then
    update app_user set email_verified_at = now(), password_hash = null, updated_at = now()
    where actor_id = p_actor;
    update refresh_session set revoked_at = coalesce(revoked_at, now()), ended_at = now()
    where actor_id = p_actor and ended_at is null;
  end if;
end $$;
