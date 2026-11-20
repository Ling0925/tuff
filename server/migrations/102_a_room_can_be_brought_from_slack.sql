/*
 * A room's history brought across from Slack.
 *
 * The name a message was said under, when whoever said it is not in this
 * workspace: kept on the message rather than made into a member, because a
 * Slack workspace's people are not seats on this one's plan.
 */
alter table message add column said_as text;

alter type origin_kind add value if not exists 'import';

/*
 * Who in this workspace has these emails, for the importer to put each
 * message under the person who said it. Emails are not readable across
 * people under row-level security, so the question is asked here, of the
 * caller's own workspace only, and answers nothing else.
 */
create function members_by_email(p_emails text[])
returns table (email text, actor_id uuid)
language sql stable security definer set search_path = public as $$
  select lower(u.email::text), u.actor_id
  from app_user u
  join membership m on m.actor_id = u.actor_id
  where m.workspace_id = current_workspace()
    and m.deleted_at is null
    and lower(u.email::text) = any(select lower(e) from unnest(p_emails) e)
$$;
grant execute on function members_by_email(text[]) to tracker_app;
