/*
 * The step a passcode spends is one of now's,
 * and the review of the night audit (7).
 *
 * `auth_totp_spend` (migration 293) took any step it was given and kept
 * it if it was past the last: `auth_totp_spend(somebody, 9e18)` would have
 * refused every code their authenticator ever showed again. The server
 * only ever hands it the step a code matched, one either side of now, so
 * that is all it takes now — measured against the database's clock, the
 * same window the code was checked in.
 *
 * And a step already kept past that window, which only a call like the
 * one above could have written, is cleared.
 *
 * Runs again harmlessly.
 */

create or replace function auth_totp_spend(p_actor uuid, p_step bigint) returns boolean
language sql volatile security definer set search_path = public, pg_temp as $$
  with spent as (
    update app_user set totp_last_step = p_step
    where actor_id = p_actor
      and abs(p_step - floor(extract(epoch from now()) / 30)::bigint) <= 1
      and (totp_last_step is null or totp_last_step < p_step)
    returning 1
  )
  select exists (select 1 from spent)
$$;

update app_user set totp_last_step = null
where totp_last_step > floor(extract(epoch from now()) / 30)::bigint + 1;
