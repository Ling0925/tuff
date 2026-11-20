/*
 * The feed's lines about the workspace are the owner's to read
 * finding 9.
 *
 * The audit log is the owner's, and half of it is lines of the feed: a
 * switch turned, somebody's rights changed, somebody removed, the
 * workspace handed over, an agent, Slack, GitHub or a webhook connected —
 * the webhook's host in its `meta`. `audit_page` answers the owner alone,
 * but the same rows were readable through `GET /api/activity` by every
 * member and every token, because `ae_read` let through any line with no
 * project that was not about a room.
 *
 * Now a line about no project and no room is read by an owner of the
 * workspace, or by whoever wrote it — one's own doing is not news to
 * oneself, and "your data" exports it. The server asks `can()` as well
 * (`audit.read`, from a session), so the owner's own token is not served
 * them either, as it is not served the log.
 *
 * Changes no rows.
 */

/* The workspaces the asker owns, as a set made once a query —
   `staff_workspaces()`'s shape. */
create function owned_workspaces() returns setof uuid
language sql stable security definer set search_path = public as $$
  select m.workspace_id from membership m
  where m.actor_id = current_actor() and m.deleted_at is null and m.joined_at is not null
    and m.role = 'owner'
    and (current_workspace() is null or m.workspace_id = current_workspace())
$$;
grant execute on function owned_workspaces() to tracker_app;

drop policy ae_read on activity_event;
create policy ae_read on activity_event for select using (
  workspace_id in (select staff_workspaces())
  and (
    (project_id is not null and project_id in (select visible_projects()))
    or (project_id is null and object_type is distinct from 'conversation'
        and (actor_id = current_actor() or workspace_id in (select owned_workspaces())))
    or (project_id is null and object_type = 'conversation' and object_id in (select visible_conversations()))
  )
);
