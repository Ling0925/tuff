/*
 * A task can move to another project, and what was said on it goes with it.
 *
 * A comment's project was immutable because it is the comment's hiding place:
 * changing it at will would move somebody's words under readers they were not
 * written for. A cross-project task move is the one time the place itself has
 * moved. The trigger still refuses a project that is not the task's own; the
 * definer below is the narrow door the endpoint uses, and it asks the same
 * permissions the endpoint does before re-homing the thread.
 */

create or replace function comment_stays_whose_it_is() returns trigger
language plpgsql as $$
begin
  if new.author_id is distinct from old.author_id
     or new.workspace_id is distinct from old.workspace_id
     or new.object_type is distinct from old.object_type
     or new.object_id is distinct from old.object_id
     or new.created_at is distinct from old.created_at then
    raise exception 'a comment keeps its author, its place and its time'
      using errcode = 'check_violation';
  end if;
  if new.project_id is distinct from old.project_id
     and not (new.object_type = 'task'
              and exists (select 1 from task t where t.id = new.object_id and t.project_id = new.project_id)) then
    raise exception 'a comment keeps its author, its place and its time'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

/*
 * Re-home every comment on a task and its parts to the project the task is
 * already in. One statement's worth of work, but behind a definer because the
 * mover need not be the author of every comment — and still not a general
 * permission to move comments: the task must already have moved, both projects
 * must be visible to this actor and token, and the actor must be the task's
 * author or hold deletion on the project it left, plus creation where it went.
 * A tool never uses it: moving work out of a project is a person's press.
 */
create or replace function move_task_comments_with_task(p_task uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  tsk record;
  sources int;
  source uuid;
  may_leave boolean;
  may_enter boolean;
begin
  select x.project_id, x.author_id, x.workspace_id into tsk
  from task x
  where x.id = p_task and x.deleted_at is null;
  if not found or tsk.workspace_id is distinct from current_workspace() or current_actor() is null then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  select count(distinct c.project_id), (array_agg(distinct c.project_id))[1] into sources, source
  from comment c
  where c.object_type = 'task'
    and c.object_id in (select x.id from task x where x.id = p_task or x.parent_id = p_task)
    and c.deleted_at is null
    and c.project_id is distinct from tsk.project_id;
  if sources = 0 then
    return;
  end if;
  if sources <> 1 or source is null
     or not (source in (select visible_projects()))
     or not (tsk.project_id in (select visible_projects())) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  may_leave := not via_tool() and (
    tsk.author_id = current_actor()
    or role_in(tsk.workspace_id) = 'owner'
    or exists (
      select 1 from project_member pm
      where pm.project_id = source and pm.actor_id = current_actor() and pm.deleted_at is null
        and pm.rights && array['task.delete', 'manage']
    )
  );
  may_enter := role_in(tsk.workspace_id) = 'owner' or exists (
    select 1 from project_member pm
    where pm.project_id = tsk.project_id and pm.actor_id = current_actor() and pm.deleted_at is null
      and pm.rights && array['task.create', 'manage']
  );
  if not may_leave or not may_enter then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  update comment c set project_id = tsk.project_id, updated_at = now()
  where c.object_type = 'task'
    and c.object_id in (select x.id from task x where x.id = p_task or x.parent_id = p_task)
    and c.project_id = source;
end $$;
revoke all on function move_task_comments_with_task(uuid) from public;
grant execute on function move_task_comments_with_task(uuid) to tracker_app;
