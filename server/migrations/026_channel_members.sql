-- Who is in a channel, as distinct from who has read it.
--
-- `conversation_member` has meant two things at once. For a direct
-- conversation it is the membership — there is no project to fall back on, so
-- the row is the access rule. For a project channel it has meant nothing at
-- all except a read mark: `mark_read` inserts a row lazily so it has somewhere
-- to put `last_read_at`, and the row grants nothing the project did not grant
-- already.
--
-- That worked only because membership could never *narrow* anything. The
-- moment a channel can be made for four people out of nine, the two meanings
-- collide: the first person to open an open channel would have a row, and the
-- channel would close behind them around whoever happened to read it first.
-- Nobody would see an error; the room would simply go quiet for everybody
-- else.
--
-- So the two are separated by a column. `joined_at` means somebody was put in
-- this room on purpose. A read mark leaves it null and changes nothing.
alter table conversation_member add column joined_at timestamptz;

-- The rows that were always membership: a direct conversation has no project
-- to fall back on, so everyone already in one is in it on purpose.
update conversation_member cm
set joined_at = cm.created_at
from conversation cv
where cv.id = cm.conversation_id and cv.project_id is null;

/*
 * A channel with nobody chosen belongs to the project, and a channel with
 * somebody chosen belongs to them.
 *
 * Read the two arms carefully: the second one is not "the project can see it",
 * it is "the project can see it *and* nobody was chosen". Without that second
 * half a restricted channel would still be readable by the whole project,
 * which is the failure that does not announce itself — the room looks private
 * and is not.
 */
create or replace function can_see_conversation(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from conversation cv
    where cv.id = c and cv.deleted_at is null and (
      exists (
        select 1 from conversation_member cm
        where cm.conversation_id = cv.id and cm.actor_id = current_actor()
          and cm.joined_at is not null and cm.deleted_at is null
      )
      or (
        cv.project_id is not null
        and can_read_object(cv.workspace_id, cv.project_id, cv.visible_to_client)
        and not exists (
          select 1 from conversation_member cm
          where cm.conversation_id = cv.id and cm.joined_at is not null
            and cm.deleted_at is null
        )
      )
    )
  )
$$;

/*
 * Who is in it, answered the same way for both kinds of room.
 *
 * Definer, because the names belong to other people and `actor` is readable
 * only through the workspace — a plain query as the person asking returns
 * emptiness, and emptiness here reads as "nobody is in this channel". The
 * caller still has to be able to see the conversation, which is the first
 * thing it checks.
 */
create function channel_members(p_conversation uuid)
returns table (actor_id uuid, name text)
language sql stable security definer set search_path = public as $$
  with room as (
    select * from conversation where id = p_conversation and deleted_at is null
  ),
  chosen as (
    select cm.actor_id from conversation_member cm, room
    where cm.conversation_id = room.id and cm.joined_at is not null
      and cm.deleted_at is null
  )
  select a.id, a.name
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
