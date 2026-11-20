/*
 * "Nobody is in this room" means nobody can see it — the re-review of
 * migration 245.
 *
 * 245 counted as in a room only its joined people still on the project.
 * But a room is seen by its joined people who are in the project the way
 * `in_project()` says — on it, or an owner or admin of the workspace, who
 * need not be. So an owner who made a room for themselves and stepped off
 * the project still read it, while it was listed as empty: a member with
 * `channel.delete` could open it to the project and read the owner's words.
 *
 * Now both read one rule, `on_project(project, actor)`: `in_project()`
 * asks it of the asker, `room_is_empty()` of each joined person. They
 * cannot drift apart.
 *
 * And `room_is_empty` is nobody's to call but the definer functions that
 * use it — it asked nothing of its caller — and `empty_room_end` locks the
 * room before it looks again, so somebody put back in at the same moment
 * is not shut out of a room deleted or opened under them.
 *
 * Changes no rows.
 */

/* Whether this actor is in this project the way a room is seen through it:
   a live, joined member of its workspace, and on the project or an owner
   or admin there. The token's bound and the session's workspace are the
   asker's, and stay in `in_project()`. */
create function on_project(p_project uuid, p_actor uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from project pr
    join membership m on m.workspace_id = pr.workspace_id and m.actor_id = p_actor
      and m.deleted_at is null and m.joined_at is not null
    where pr.id = p_project
      and (
        m.role in ('owner', 'admin')
        or exists (
          select 1 from project_member pm
          where pm.project_id = p_project and pm.actor_id = p_actor and pm.deleted_at is null
        )
      )
  )
$$;
revoke all on function on_project(uuid, uuid) from public;
grant execute on function on_project(uuid, uuid) to tracker_app;

/* 191's, with the people half asked of `on_project`. */
create or replace function in_project(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select ((select token_projects()) is null or p = any ((select token_projects())::uuid[])) and exists (
    select 1 from project pr
    where pr.id = p
      and (current_workspace() is null or pr.workspace_id = current_workspace())
      and on_project(p, current_actor())
  )
$$;

/* 245's, with "in the room" as visibility has it, inside the session's workspace. */
create or replace function room_is_empty(p_conversation uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from conversation cv
    where cv.id = p_conversation and cv.deleted_at is null and cv.project_id is not null and cv.chosen
      and (current_workspace() is null or cv.workspace_id = current_workspace())
      and not exists (
        select 1 from conversation_member cm
        where cm.conversation_id = cv.id and cm.joined_at is not null and cm.deleted_at is null
          and on_project(cv.project_id, cm.actor_id)
      )
  )
$$;
revoke execute on function room_is_empty(uuid) from tracker_app;

create or replace function empty_room_end(p_conversation uuid, p_open boolean) returns boolean
language plpgsql volatile security definer set search_path = public as $$
begin
  /* Held while it is looked at again: a person put back in meanwhile waits
     for this, or this sees them. */
  perform 1 from conversation where id = p_conversation for update;
  if empty_room_project(p_conversation) is null then
    return false;
  end if;
  if p_open then
    update conversation set chosen = false, updated_at = now() where id = p_conversation;
    update conversation_member set joined_at = null, updated_at = now()
    where conversation_id = p_conversation and joined_at is not null and deleted_at is null;
  else
    update conversation set deleted_at = now(), updated_at = now() where id = p_conversation;
  end if;
  return true;
end $$;
