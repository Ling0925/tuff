/*
 * The second factor, after the review of migration 242,
 */

/* ------------------------------------------- a secret begun is short-lived

   Enabling checked only a code against the stored secret. A secret begun
   and left — or begun before beginning asked who it was — was a way to turn
   the factor on with that code alone, for ever. A secret is now turned on
   within a quarter of an hour of being begun or not at all; one begun
   before this column has no date and fails. No row is rewritten. */
alter table app_user add column if not exists totp_begun_at timestamptz;

/* Begun only over a factor that is off, and says whether it was: the route
   looks first, and an enable landing between its look and this write was
   switched off again with a fresh secret written over it. */
drop function if exists auth_totp_begin(uuid, text);
create function auth_totp_begin(p_actor uuid, p_secret_enc text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update app_user set totp_secret_enc = p_secret_enc, totp_enabled = false,
                      totp_begun_at = now(), updated_at = now()
  where actor_id = p_actor and not totp_enabled;
  return found;
end $$;
grant execute on function auth_totp_begin(uuid, text) to tracker_app;

/* `ok` turned on now; `on` already on; `expired` nothing begun in the last
   quarter of an hour. Recovery codes are dealt only on `ok`. */
drop function if exists auth_totp_enable(uuid);
create function auth_totp_enable(p_actor uuid) returns text
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from app_user where actor_id = p_actor and totp_enabled) then
    return 'on';
  end if;
  update app_user set totp_enabled = true, totp_enabled_at = now(), totp_begun_at = null, updated_at = now()
  where actor_id = p_actor and totp_secret_enc is not null and not totp_enabled
    and totp_begun_at > now() - interval '15 minutes';
  if found then
    return 'ok';
  end if;
  return 'expired';
end $$;
grant execute on function auth_totp_enable(uuid) to tracker_app;

create or replace function auth_totp_disable(p_actor uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update app_user set totp_enabled = false, totp_secret_enc = null, totp_enabled_at = null,
                      totp_begun_at = null, updated_at = now()
  where actor_id = p_actor;
  -- The codes go with it. Leaving them is leaving a way in that the person
  -- believes they have turned off.
  delete from recovery_code where actor_id = p_actor;
end $$;
