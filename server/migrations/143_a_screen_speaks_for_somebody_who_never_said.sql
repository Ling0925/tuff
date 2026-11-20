/*
 * Whether somebody ever said what they read.
 *
 * `language_of` reads never-said as English, which is right for a push:
 * nobody is looking, and English is what an account made before there was
 * a second language has always been sent. It is wrong for a mail asked for
 * from a screen before signing in — a reset, a confirmation — where the
 * screen's own language is a better guess than English for an account that
 * never chose, and only a choice the account did make outranks it. So this
 * answers the choice as it is, null and all, and the caller decides what
 * null comes to.
 *
 * Across the row-level boundary for the reason `language_of` is: these
 * mails are sent with no actor at all.
 */
create function language_said(p_actor uuid)
returns text
language sql stable security definer set search_path = public as $$
  select u.language from app_user u where u.actor_id = p_actor
$$;

grant execute on function language_said to tracker_app;
