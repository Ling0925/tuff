/*
 * The language somebody reads the product in.
 *
 * On the account rather than the membership: a person reads French in
 * every workspace they are in, not in one company's. Null is "never said",
 * which is every account made before there was a second language, and
 * reads as English; what was said on a device is sent here so that the
 * mail and the pushes, which no device is drawing, speak it too.
 */
alter table app_user add column language text check (language in ('en', 'fr'));

-- Column by column, as 005 explains: a new column is invisible until named.
grant select (language) on app_user to tracker_app;
grant update (language) on app_user to tracker_app;

/*
 * Somebody else's language, for what is sent to them — a push, a digest,
 * an invitation's sender. Read across the row-level boundary for the
 * reason `notify_prefs` is: app_user answers only to its own actor, and a
 * push is composed while somebody else is acting.
 */
create function language_of(p_actor uuid)
returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select u.language from app_user u where u.actor_id = p_actor), 'en')
$$;

grant execute on function language_of to tracker_app;
