-- What somebody does, in their own words — `docs/specs/person-card.md`.
-- Optional, theirs to set, and short: it is a line under a name.
alter table actor add column title text check (char_length(title) <= 80);

-- The two things a colleague's card shows that live on `app_user`, which
-- is otherwise readable only by its owner: the email they signed in with
-- and the zone their clock is in. Answered only for somebody in the
-- asker's current workspace, and only to somebody in it.
create function colleague_card(p_actor uuid)
returns table (email citext, timezone text)
language sql stable security definer set search_path = public as $$
  select u.email, u.timezone
  from app_user u
  where u.actor_id = p_actor
    and current_workspace() is not null
    and exists (select 1 from membership m
                where m.actor_id = p_actor and m.workspace_id = current_workspace()
                  and m.deleted_at is null)
    and exists (select 1 from membership m
                where m.actor_id = current_actor() and m.workspace_id = current_workspace()
                  and m.deleted_at is null)
$$;
grant execute on function colleague_card to tracker_app;
