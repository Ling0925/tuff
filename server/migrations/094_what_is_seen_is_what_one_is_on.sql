/*
 * What a person reads follows what they are on.
 */

/*
 * A room a person was added to stays theirs only while they can still see
 * its project. Taken off a project, somebody kept a chosen channel of it —
 * reading and writing — because their row in the room was enough on its own.
 */
create or replace function visible_conversations() returns setof uuid
language sql stable security definer set search_path = public as $$
  select cv.id from conversation cv
  where cv.deleted_at is null
    and (current_workspace() is null or cv.workspace_id = current_workspace())
    and (cv.project_id is null or cv.project_id in (select visible_projects()))
    and (
    exists (
      select 1 from conversation_member cm
      where cm.conversation_id = cv.id and cm.actor_id = current_actor()
        and cm.joined_at is not null and cm.deleted_at is null
    )
    or (
      cv.project_id is not null
      and not exists (
        select 1 from conversation_member cm
        where cm.conversation_id = cv.id and cm.joined_at is not null
          and cm.deleted_at is null
      )
    )
  )
$$;

/* The same question for the room's socket and its list of people — and
   bounded by the workspace the session is in, which it was not. */
create or replace function can_see_conversation(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from conversation cv
    where cv.id = c and cv.deleted_at is null
      and (current_workspace() is null or cv.workspace_id = current_workspace())
      and (cv.project_id is null or in_project(cv.project_id))
      and (
        exists (
          select 1 from conversation_member cm
          where cm.conversation_id = cv.id and cm.actor_id = current_actor()
            and cm.joined_at is not null and cm.deleted_at is null
        )
        or (
          cv.project_id is not null
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
 * Reading a room marks it read — for a room the reader can see, in the
 * workspace it belongs to. It took any id and wrote a row of membership for
 * it, so a room in another company could be "read", and the reader was then
 * told of every message said in it.
 */
create or replace function mark_read(p_conversation uuid, p_actor uuid, p_workspace uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  at timestamptz;
  home uuid;
begin
  if p_actor is distinct from current_actor() or not can_see_conversation(p_conversation) then
    return;
  end if;
  select workspace_id into home from conversation where id = p_conversation;
  select greatest(now(), max(m.created_at)) into at
  from message m
  where m.conversation_id = p_conversation and m.deleted_at is null;

  insert into conversation_member (id, workspace_id, conversation_id, actor_id, last_read_at)
  values (gen_random_uuid(), home, p_conversation, p_actor, coalesce(at, now()))
  on conflict (conversation_id, actor_id) where deleted_at is null
  do update set last_read_at = greatest(conversation_member.last_read_at, excluded.last_read_at),
                updated_at = now();
end $$;

/*
 * The feed shows what happened to what the reader can see. It was every
 * event in the workspace, and an event carries words of its own — a task's
 * old and new title, a private channel's name, who was given what — so a
 * member read the history of projects and rooms they were never on.
 */
drop policy ae_read on activity_event;
create policy ae_read on activity_event for select using (
  is_member(workspace_id)
  and (
    (project_id is not null and project_id in (select visible_projects()))
    or (project_id is null and object_type is distinct from 'conversation')
    or (project_id is null and object_type = 'conversation' and object_id in (select visible_conversations()))
  )
);
