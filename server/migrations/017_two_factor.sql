-- The second factor, which until now was a column and a check that did not
-- check anything.
--
-- `app_user` is not readable or writable by the application role — that is
-- the point of the column grants — so every step here goes through a
-- security definer function, the same as looking a user up does.

create table recovery_code (
  id uuid primary key,
  actor_id uuid not null references actor(id),
  code_hash text not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index recovery_code_by_actor on recovery_code (actor_id) where used_at is null;

alter table recovery_code enable row level security;
-- Nobody reads these through the application role. They are checked by a
-- definer function during sign-in, when there is no actor set at all.
revoke all on recovery_code from tracker_app;

/* Stored, not enabled: the secret exists while the person is still proving
   they can read it. An account is never left with the factor on and a secret
   nobody has managed to scan. */
create function auth_totp_begin(p_actor uuid, p_secret_enc text)
returns void language sql security definer set search_path = public as $$
  update app_user set totp_secret_enc = p_secret_enc, totp_enabled = false,
                      updated_at = now()
  where actor_id = p_actor
$$;

create function auth_totp_secret(p_actor uuid)
returns text language sql stable security definer set search_path = public as $$
  select totp_secret_enc from app_user where actor_id = p_actor
$$;

/* By email, for the one moment there is no session yet. */
create function auth_totp_secret_for(p_email citext)
returns text language sql stable security definer set search_path = public as $$
  select totp_secret_enc from app_user where email = p_email
$$;

create function auth_totp_enable(p_actor uuid)
returns void language sql security definer set search_path = public as $$
  update app_user set totp_enabled = true, updated_at = now()
  where actor_id = p_actor and totp_secret_enc is not null
$$;

create function auth_totp_disable(p_actor uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update app_user set totp_enabled = false, totp_secret_enc = null, updated_at = now()
  where actor_id = p_actor;
  -- The codes go with it. Leaving them is leaving a way in that the person
  -- believes they have turned off.
  delete from recovery_code where actor_id = p_actor;
end $$;

create function auth_recovery_replace(p_actor uuid, p_hashes text[])
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from recovery_code where actor_id = p_actor;
  insert into recovery_code (id, actor_id, code_hash)
  select gen_random_uuid(), p_actor, h from unnest(p_hashes) h;
end $$;

/* Single use, and the spending is the check: two people cannot race the same
   code into two sessions, because only one update finds it unused. */
create function auth_recovery_spend(p_actor uuid, p_hash text)
returns boolean language plpgsql security definer set search_path = public as $$
declare hit uuid;
begin
  update recovery_code set used_at = now()
  where actor_id = p_actor and code_hash = p_hash and used_at is null
  returning id into hit;
  return hit is not null;
end $$;

create function auth_recovery_left(p_actor uuid)
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::int from recovery_code where actor_id = p_actor and used_at is null
$$;

grant execute on function auth_totp_begin, auth_totp_secret, auth_totp_secret_for,
  auth_totp_enable, auth_totp_disable, auth_recovery_replace, auth_recovery_spend,
  auth_recovery_left to tracker_app;

/* Confirming a password from a signed-in session, for the acts that need it
   again: turning the second factor off is the first of them. */
create function auth_password_hash(p_actor uuid)
returns text language sql stable security definer set search_path = public as $$
  select password_hash from app_user where actor_id = p_actor
$$;

grant execute on function auth_password_hash to tracker_app;
