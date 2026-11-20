/*
 * A passcode is taken once, and
 * The night audit (7).
 *
 * A code is good one step either side of now, and it was taken as often
 * as anybody typed it inside those ninety seconds: one seen over a
 * shoulder, or lifted by a page that asked for it, signed in again.
 * RFC 6238 §5.2 asks that a code be accepted once.
 *
 * The step the last good code matched is kept beside the secret, on
 * `app_user`. The application role cannot select it, but it holds insert
 * and update on the whole of `app_user` (migrations 001 and 002), this
 * column included — taking those back is an open item
 * (the night audit); 299 bounds what may
 * be written through `auth_totp_spend`. `auth_totp_spend`
 * writes it only when the step is past the one kept, in the update that
 * reads it: two sign-ins racing one code both find the row, the second
 * waits on the first's lock, finds the step taken, and is refused.
 *
 * A new secret starts with no step kept: beginning again writes one whose
 * codes the old secret's never were, so a step taken under the old one
 * holds nothing back — and kept, it refused the first code of a factor
 * turned off and on again within the minute. Otherwise `auth_totp_begin`
 * is migration 243's.
 *
 * Written to run again harmlessly, should its number change.
 */

alter table app_user add column if not exists totp_last_step bigint;

create or replace function auth_totp_spend(p_actor uuid, p_step bigint) returns boolean
language sql volatile security definer set search_path = public, pg_temp as $$
  with spent as (
    update app_user set totp_last_step = p_step
    where actor_id = p_actor and (totp_last_step is null or totp_last_step < p_step)
    returning 1
  )
  select exists (select 1 from spent)
$$;
revoke all on function auth_totp_spend(uuid, bigint) from public;
grant execute on function auth_totp_spend(uuid, bigint) to tracker_app;

create or replace function auth_totp_begin(p_actor uuid, p_secret_enc text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update app_user set totp_secret_enc = p_secret_enc, totp_enabled = false,
                      totp_begun_at = now(), totp_last_step = null, updated_at = now()
  where actor_id = p_actor and not totp_enabled;
  return found;
end $$;
