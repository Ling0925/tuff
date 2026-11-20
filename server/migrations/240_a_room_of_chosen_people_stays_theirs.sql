/*
 * A project's channel made for chosen people stays theirs when the last of
 * them goes finding 4.
 *
 * Who could see a project's room was read from its rows: some people in it,
 * those people; nobody in it, everybody on the project. The second half
 * cannot tell "nobody was chosen" from "everybody chosen has gone", and
 * people go without anybody deciding anything about the room — taken out of
 * the workspace (`remove_from_workspace` takes them out of every channel),
 * an agent disconnected, the last one unticked by somebody else. The room
 * of four, emptied, opened to the whole project with its history in it.
 *
 * So the room says which it is: `conversation.chosen`. True is "only its
 * people", whoever is left of them, nobody included; false on a project's
 * room is everybody on the project. It is not a second thing somebody has
 * to remember to set (api.md once argued against a flag for that reason):
 * a trigger sets it the moment anybody is put in a project's room on
 * purpose, and only handing the room back to the project —
 * `PUT /conversations/:id/members` with null — clears it. Rooms outside
 * projects are their rows, as they always were; the flag means nothing
 * there and stays false.
 *
 * The rows are read the same way everywhere else, so every function that
 * read "nobody joined" is made again with "not chosen" in its place; each
 * is otherwise the text of the migration named over it.
 *
 * REWRITES ROWS: `conversation.chosen` is set on every project room that
 * has somebody in it now, which is exactly the set the old rule treated as
 * chosen — nobody's access changes on the day it runs. A room that already
 * lost its last chosen person cannot be told from a project-wide one and
 * stays project-wide.
 */

alter table conversation add column chosen boolean not null default false;

update conversation cv set chosen = true
where cv.project_id is not null and not cv.chosen
  and exists (
    select 1 from conversation_member cm
    where cm.conversation_id = cv.id and cm.joined_at is not null and cm.deleted_at is null
  );

/* Anybody put in a project's room is somebody chosen. Whoever writes the
   row — the server, the seed, an import — the room becomes theirs. */
create function conversation_becomes_chosen() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update conversation set chosen = true
  where id = new.conversation_id and project_id is not null and not chosen;
  return new;
end $$;
create trigger conversation_becomes_chosen
  after insert or update of joined_at, deleted_at on conversation_member
  for each row when (new.joined_at is not null and new.deleted_at is null)
  execute function conversation_becomes_chosen();

/* ------------------------------------------------- 191 */

create or replace function visible_conversations() returns setof uuid
language sql stable security definer set search_path = public as $$
  select cv.id from conversation_member cm
  join conversation cv on cv.id = cm.conversation_id
  where cm.actor_id = current_actor() and cm.joined_at is not null and cm.deleted_at is null
    and cv.deleted_at is null
    and (current_workspace() is null or cv.workspace_id = current_workspace())
    and exists (select 1 from membership mm where mm.workspace_id = cv.workspace_id and mm.actor_id = current_actor() and mm.joined_at is not null and mm.deleted_at is null)
    and ((cv.project_id is null and (select token_projects()) is null) or cv.project_id in (select visible_projects()))
  union
  select cv.id from conversation cv
  where cv.project_id in (select visible_projects()) and cv.deleted_at is null
    and not cv.chosen
$$;

create or replace function can_see_conversation(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from conversation cv
    where cv.id = c and cv.deleted_at is null
      and (current_workspace() is null or cv.workspace_id = current_workspace())
      and exists (select 1 from membership mm where mm.workspace_id = cv.workspace_id and mm.actor_id = current_actor() and mm.joined_at is not null and mm.deleted_at is null)
      and ((cv.project_id is null and (select token_projects()) is null) or in_project(cv.project_id))
      and (
        exists (
          select 1 from conversation_member cm
          where cm.conversation_id = cv.id and cm.actor_id = current_actor()
            and cm.joined_at is not null and cm.deleted_at is null
        )
        or (cv.project_id is not null and not cv.chosen)
      )
  )
$$;

create or replace function conversation_seen(p uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(cv.name, 'main') from conversation cv
  where cv.id = p
    and (current_workspace() is null or cv.workspace_id = current_workspace())
    and ((cv.project_id is null and (select token_projects()) is null) or cv.project_id in (select visible_projects()))
    and (
      exists (
        select 1 from conversation_member cm
        where cm.conversation_id = cv.id and cm.actor_id = current_actor()
          and cm.joined_at is not null and cm.deleted_at is null
      )
      or (cv.project_id is not null and not cv.chosen)
    )
$$;

/* ------------------------------------------------- 116 */

create or replace function sees_conversation(p_conversation uuid, p_actor uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select can_see_conversation(p_conversation) and exists (
    select 1 from conversation cv
    join membership m on m.workspace_id = cv.workspace_id and m.actor_id = p_actor
      and m.deleted_at is null and m.joined_at is not null
    where cv.id = p_conversation and cv.deleted_at is null
      and (
        cv.project_id is null or m.role = 'owner'
        or exists (
          select 1 from project_member pm
          where pm.project_id = cv.project_id and pm.actor_id = p_actor and pm.deleted_at is null
        )
      )
      and (
        exists (
          select 1 from conversation_member cm
          where cm.conversation_id = cv.id and cm.actor_id = p_actor
            and cm.joined_at is not null and cm.deleted_at is null
        )
        or (cv.project_id is not null and not cv.chosen)
      )
  )
$$;

/* ------------------------------------------------- 173 */

create or replace function queue_webhooks(p_workspace uuid, p_event text, p_payload jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if current_workspace() is not null and p_workspace <> current_workspace() then
    return 0;
  end if;
  if p_payload->>'object_type' = 'conversation' and not exists (
    select 1 from conversation cv
    where cv.id = (p_payload->>'object_id')::uuid and cv.workspace_id = p_workspace
      and cv.project_id is not null
      and not cv.chosen
  ) then
    return 0;
  end if;
  insert into webhook_delivery (id, workspace_id, webhook_id, event, payload)
  select gen_random_uuid(), p_workspace, w.id, p_event, p_payload
  from webhook w
  where w.workspace_id = p_workspace and w.enabled and w.deleted_at is null
    and w.agent_id is null
    and (cardinality(w.events) = 0 or p_event = any(w.events));
  get diagnostics n = row_count;
  return n;
end $$;

/* ------------------------------------------------- 137 */

create or replace function room_people(p_conversation uuid) returns table (actor_id uuid)
language sql stable security definer set search_path = public as $$
  select cm.actor_id from conversation_member cm
  join conversation c on c.id = cm.conversation_id
  where cm.conversation_id = p_conversation and cm.deleted_at is null and cm.joined_at is not null
    and is_member(c.workspace_id)
  union
  select pm.actor_id from conversation c
  join project_member pm on pm.project_id = c.project_id and pm.deleted_at is null
  where c.id = p_conversation and c.project_id is not null and c.channel and is_member(c.workspace_id)
    and not c.chosen
$$;

/* ------------------------------------------------- 172 */

create or replace function channel_members(p_conversation uuid)
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
  , who as (
    select actor_id from chosen
    union
    select pm.actor_id
    from project_member pm, room
    where not room.chosen
      and pm.project_id = room.project_id and pm.deleted_at is null
  )
  select a.id, a.name, a.avatar_key
  from who
  join actor a on a.id = who.actor_id
  join room on true
  join membership m on m.workspace_id = room.workspace_id and m.actor_id = a.id and m.deleted_at is null
  where can_see_conversation(p_conversation)
  order by a.name
$$;
