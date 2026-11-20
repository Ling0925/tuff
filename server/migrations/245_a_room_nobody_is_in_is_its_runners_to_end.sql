/*
 * A project's room of chosen people whose people have all gone is still
 * somebody's to end, the review of
 * finding 4.
 *
 * Since 240 such a room stays closed, which is right, and was reachable by
 * nobody — not the owner, not whoever may delete the project's channels —
 * so it could be neither deleted nor handed back to the project. Now the
 * owner and anybody holding `channel.delete` (or `manage`) on the project
 * may see that it exists, by its name, and end it either way. Never what
 * was said in it: these functions answer a name and a project, and the
 * room's messages stay behind `can_see_conversation` as before.
 *
 * `can()` decides first, on the server; the database asks the same of the
 * caller here, so a route that forgets cannot open somebody else's room.
 *
 * Changes no rows.
 */

/* Whether the asker may end the rooms of this project that nobody is in. */
create function may_end_empty_rooms(p_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select ((select token_projects()) is null or p_project = any ((select token_projects())::uuid[]))
    and exists (
      select 1 from project pr
      where pr.id = p_project and pr.deleted_at is null
        and pr.workspace_id = current_workspace()
        and (
          role_in(pr.workspace_id) = 'owner'
          or exists (
            select 1 from project_member pm
            join membership m on m.workspace_id = pr.workspace_id and m.actor_id = pm.actor_id
              and m.deleted_at is null and m.joined_at is not null
            where pm.project_id = pr.id and pm.actor_id = current_actor() and pm.deleted_at is null
              and (pm.rights && array['channel.delete', 'manage'])
          )
        )
    )
$$;
grant execute on function may_end_empty_rooms(uuid) to tracker_app;

/* A chosen room with nobody in it: no joined row of somebody still on the
   project and in the workspace. */
create function room_is_empty(p_conversation uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from conversation cv
    where cv.id = p_conversation and cv.deleted_at is null and cv.project_id is not null and cv.chosen
      and not exists (
        select 1 from conversation_member cm
        join project_member pm on pm.project_id = cv.project_id and pm.actor_id = cm.actor_id and pm.deleted_at is null
        join membership m on m.workspace_id = cv.workspace_id and m.actor_id = cm.actor_id
          and m.deleted_at is null and m.joined_at is not null
        where cm.conversation_id = cv.id and cm.joined_at is not null and cm.deleted_at is null
      )
  )
$$;
grant execute on function room_is_empty(uuid) to tracker_app;

/* The rooms of a project nobody is in, by name, to whoever may end them. */
create function empty_rooms(p_project uuid)
returns table (id uuid, name text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select cv.id, coalesce(cv.name, 'main'), cv.created_at from conversation cv
  where cv.project_id = p_project and cv.deleted_at is null and cv.chosen
    and may_end_empty_rooms(p_project) and room_is_empty(cv.id)
  order by cv.created_at
$$;
grant execute on function empty_rooms(uuid) to tracker_app;

/* One such room's project, or nothing: what the server asks `can()` about. */
create function empty_room_project(p_conversation uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select cv.project_id from conversation cv
  where cv.id = p_conversation and cv.workspace_id = current_workspace()
    and room_is_empty(cv.id) and may_end_empty_rooms(cv.project_id)
$$;
grant execute on function empty_room_project(uuid) to tracker_app;

/* Ended: handed back to the project (`p_open`), or deleted. True when it was. */
create function empty_room_end(p_conversation uuid, p_open boolean) returns boolean
language plpgsql volatile security definer set search_path = public as $$
begin
  if empty_room_project(p_conversation) is null then
    return false;
  end if;
  if p_open then
    update conversation set chosen = false, updated_at = now() where id = p_conversation;
    /* Rows of people off the project would otherwise make it chosen again
       the next time anybody touched them, and mean nothing now. */
    update conversation_member set joined_at = null, updated_at = now()
    where conversation_id = p_conversation and joined_at is not null and deleted_at is null;
  else
    update conversation set deleted_at = now(), updated_at = now() where id = p_conversation;
  end if;
  return true;
end $$;
grant execute on function empty_room_end(uuid, boolean) to tracker_app;
