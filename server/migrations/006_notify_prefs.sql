-- Notifying somebody means reading *their* preferences, and app_user is
-- readable only by the actor it belongs to. The lookup therefore ran as the
-- person doing the thing, found nothing, and fell back to "send it now" —
-- so quiet hours and switching chat off silently did nothing at all.
--
-- Nothing failed. That is what makes it worth a function: a check that reads
-- as working and does not is harder to notice than one that throws.
create function notify_prefs(p_actor uuid)
returns table (notify_chat boolean, quiet_from time, quiet_to time, timezone text)
language sql stable security definer set search_path = public as $$
  select u.notify_chat, u.quiet_from, u.quiet_to, u.timezone
  from app_user u where u.actor_id = p_actor
$$;

grant execute on function notify_prefs to tracker_app;
