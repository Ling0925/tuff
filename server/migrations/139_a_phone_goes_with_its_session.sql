-- A device hears this person only while it is signed in.
--
-- Ending a session left its browser or phone hearing the account: what
-- was assigned, who wrote, the rooms' names. Only the browser's own sign-out
-- took its row away, from the client's side, and "sign out of that device"
-- or "every other device" — the two moments somebody means to shut a
-- device out — did nothing to it. A row now names the device it was
-- registered from, and goes when that device has no session left.
alter table push_subscription add column if not exists device text;

/* The device the asker's own session is, to register a row under it. */
create or replace function auth_session_device(p_sid uuid) returns text
language sql stable security definer set search_path = public as $$
  select device from refresh_session
  where id = p_sid and actor_id = current_actor() and ended_at is null
$$;
grant execute on function auth_session_device(uuid) to tracker_app;

/* Whichever way a session ends — signing out, ended from Account, every
   other device, a reset — its device's rows go once it has no other. */
create or replace function push_follows_session() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.device is not null and old.ended_at is null and new.ended_at is not null
     and not exists (
       select 1 from refresh_session s
       where s.actor_id = new.actor_id and s.device = new.device and s.ended_at is null
     ) then
    delete from push_subscription where actor_id = new.actor_id and device = new.device;
  end if;
  return new;
end $$;

drop trigger if exists push_follows_session on refresh_session;
create trigger push_follows_session after update of ended_at on refresh_session
  for each row execute function push_follows_session();
