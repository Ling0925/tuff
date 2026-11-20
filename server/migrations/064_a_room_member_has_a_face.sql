-- A room's members carry their picture, like everybody else drawn by name.
--
-- `channel_members` returned `(actor_id, name)`, so the one list of people
-- that comes from a definer function was the one place a face could not
-- follow. Every other person in the product is drawn from a row that now
-- carries a key -- docs/specs/avatar.md.
--
-- Replaced rather than altered: a function's return type cannot be widened
-- in place, so it is dropped and written again with the column added. The
-- body is unchanged otherwise, including the `can_see_conversation` guard
-- that is the whole reason it is a definer function.
drop function if exists channel_members(uuid);

create function channel_members(p_conversation uuid)
returns table (actor_id uuid, name text, avatar_key text)
language sql stable security definer set search_path = public as $$
  with room as (
    select * from conversation where id = p_conversation and deleted_at is null
  ),
  chosen as (
    select cm.actor_id from conversation_member cm, room
    where cm.conversation_id = room.id and cm.joined_at is not null
      and cm.deleted_at is null
  )
  select a.id, a.name, a.avatar_key
  from actor a
  where can_see_conversation(p_conversation)
    and a.id in (
      select actor_id from chosen
      union all
      select pm.actor_id
      from project_member pm, room
      where not exists (select 1 from chosen)
        and pm.project_id = room.project_id and pm.deleted_at is null
    )
  order by a.name
$$;

grant execute on function channel_members to tracker_app;
