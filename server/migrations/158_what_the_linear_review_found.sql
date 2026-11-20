/*
 * What an independent review of the Linear import found.
 *
 * Rows that only say something about one task go with the task. A part
 * waiting for its parent was left behind whenever an import stopped before
 * its last page, and the project could then never be deleted for good: its
 * tasks were still named. Three older tables had the same shape.
 */
alter table linear_import_parent
  drop constraint linear_import_parent_task_id_fkey,
  add constraint linear_import_parent_task_id_fkey foreign key (task_id) references task(id) on delete cascade;
alter table due_reminder
  drop constraint due_reminder_task_id_fkey,
  add constraint due_reminder_task_id_fkey foreign key (task_id) references task(id) on delete cascade;
alter table github_issue
  drop constraint github_issue_task_id_fkey,
  add constraint github_issue_task_id_fkey foreign key (task_id) references task(id) on delete cascade;
alter table github_pull_task
  drop constraint github_pull_task_task_id_fkey,
  add constraint github_pull_task_task_id_fkey foreign key (task_id) references task(id) on delete cascade;

/* One project a team an import: two workers meeting on one import made two. */
create unique index project_once_an_import on project (import_id, imported_from) where import_id is not null;

/*
 * Whether a project's import is still running, for anybody on it: while it
 * runs, a task made by hand would take a number Linear's next page needs,
 * and `ENG-12` would open the wrong task.
 */
create function project_importing(p_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from project p join linear_import i on i.id = p.import_id
    where p.id = p_project and i.state = 'running'
  )
$$;
grant execute on function project_importing(uuid) to tracker_app;

/* A turn's end lets the import go, so the next turn takes it at once
   rather than ten minutes later. */
drop function linear_import_progress(uuid, jsonb);
create function linear_import_progress(p_id uuid, p_progress jsonb, p_release boolean default false) returns void
language sql volatile security definer set search_path = public as $$
  update linear_import
  set progress = p_progress, claimed_at = case when p_release then null else now() end
  where id = p_id and state = 'running'
$$;
revoke execute on function linear_import_progress(uuid, jsonb, boolean) from public;
grant execute on function linear_import_progress(uuid, jsonb, boolean) to tracker_worker;
