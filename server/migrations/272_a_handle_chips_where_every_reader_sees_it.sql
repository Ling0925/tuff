/*
 * A task's handle written into a room is the task when everybody who reads
 * the room may read the task.
 *
 * A chip carries its task's title. Until now a handle chipped only into the
 * task's own project, so in a direct conversation — where an agent answering
 * somebody names the work most — nothing chipped at all, although both of
 * them were on the project.
 *
 * Whether a room's readers may read a task, asked by somebody who may read
 * the room:
 *   - a room of a project: the task is in that project. Whoever reads a
 *     project's room reads it through the project, and a room of chosen
 *     people is read by some of the project's people, never by others.
 *   - a room outside every project (a direct conversation, a group one, a
 *     channel of the workspace): every joined person in it who is a live
 *     member of the workspace may read the task's project. That is
 *     `visible_projects()` asked of each of them — the workspace's owner, or
 *     on the project — written set-based over the room's people rather than
 *     moving `app.actor_id` once a person, so a channel of a thousand is one
 *     query and not a thousand. A token's bound is the request's, not the
 *     reader's, and is not asked.
 *
 * Nothing is answered about a room the asker does not see.
 */
create function task_visible_to_all(p_task uuid, p_conversation uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from task t
    join project p on p.id = t.project_id and p.deleted_at is null
    join conversation cv on cv.id = p_conversation and cv.deleted_at is null and cv.workspace_id = t.workspace_id
    where t.id = p_task and t.deleted_at is null
      and (current_workspace() is null or cv.workspace_id = current_workspace())
      and can_see_conversation(cv.id)
      and case
        when cv.project_id is not null then t.project_id = cv.project_id
        else not exists (
          select 1 from conversation_member cm
          join membership m on m.workspace_id = cv.workspace_id and m.actor_id = cm.actor_id
            and m.deleted_at is null and m.joined_at is not null
          where cm.conversation_id = cv.id and cm.joined_at is not null and cm.deleted_at is null
            and m.role <> 'owner'
            and not exists (
              select 1 from project_member pm
              where pm.project_id = t.project_id and pm.actor_id = cm.actor_id and pm.deleted_at is null
            )
        )
      end
  )
$$;
revoke all on function task_visible_to_all(uuid, uuid) from public;
grant execute on function task_visible_to_all(uuid, uuid) to tracker_app;
