/*
 * Whether this browser has signed in to this account before — the one way
 * past an account's own ceiling of wrong guesses. `mayGuess` in
 * server/src/http/limits.ts.
 *
 * The device id is the browser's own random name for itself, sent as
 * `x-device` and written on every session it opens. Somebody guessing at an
 * account from elsewhere does not have it, so a guess spread across many
 * machines cannot shut out the person on the laptop they always use.
 */
create function auth_device_known(p_email citext, p_device text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from refresh_session s join app_user u on u.actor_id = s.actor_id
    where u.email = p_email and s.device = p_device)
$$;
grant execute on function auth_device_known(citext, text) to tracker_app;
