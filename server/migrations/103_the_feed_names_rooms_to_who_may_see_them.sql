/*
 * The feed names a room — and shows that anything happened to it — only to
 * whoever may see the room.
 *
 * `visible_conversations()` with the one difference that a removed room is
 * still asked about: "removed #design" is news to the people who were in
 * it and to nobody else, and row-level security hides a removed room from
 * everybody alike. The name, or null when this reader may not know it.
 */
create function conversation_seen(p uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(cv.name, 'main') from conversation cv
  where cv.id = p
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
grant execute on function conversation_seen(uuid) to tracker_app;

/* A project's room was opened without saying it was a room, so the feed
   could neither name it nor keep it from those who may not see it. */
update activity_event set object_type = 'conversation'
where action like 'conversation.%' and object_type is null and object_id is not null;

/* And what was removed before its name was kept with the line: the row is
   still there, soft-deleted, under the name it went with. */
update activity_event e set meta = coalesce(e.meta, '{}'::jsonb) || jsonb_build_object('title', t.title)
from task t
where e.action = 'task.delete' and t.id = e.object_id and not coalesce(e.meta ? 'title', false);
update activity_event e set meta = coalesce(e.meta, '{}'::jsonb) || jsonb_build_object('title', p.title)
from post p
where e.action = 'post.delete' and p.id = e.object_id and not coalesce(e.meta ? 'title', false);
