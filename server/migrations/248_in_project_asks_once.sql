/*
 * Two clean-ups from the review of 247.
 *
 * `in_project` asked `on_project` — a definer calling a definer, which
 * Postgres cannot fold into the query, and twice the cost per call. The
 * same rule, written straight in: a joined, live member of the project's
 * workspace who is an owner or admin there, or on the project. `on_project`
 * stays for `room_is_empty`, which asks it of somebody else.
 *
 * And `on_project` answered the application role about any person and any
 * project, which nothing outside the definers needs: revoked, as
 * `room_is_empty` was.
 */
create or replace function in_project(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select ((select token_projects()) is null or p = any ((select token_projects())::uuid[])) and exists (
    select 1 from project pr
    join membership m on m.workspace_id = pr.workspace_id and m.actor_id = current_actor()
      and m.deleted_at is null and m.joined_at is not null
    where pr.id = p
      and (current_workspace() is null or pr.workspace_id = current_workspace())
      and (
        m.role in ('owner', 'admin')
        or exists (
          select 1 from project_member pm
          where pm.project_id = p and pm.actor_id = current_actor() and pm.deleted_at is null
        )
      )
  )
$$;

revoke execute on function on_project(uuid, uuid) from tracker_app;
