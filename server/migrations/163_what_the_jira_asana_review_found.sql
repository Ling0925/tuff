/*
 * What an independent review of the Jira and Asana import found.
 *
 * Asana numbers nothing, and numbering its tasks by their place made a page
 * read again — after a wait, an offset Asana forgot, a task added in Asana
 * meanwhile — skip some and bring others twice. A task brought is now
 * remembered by Asana's own id, in its project, and that is what is asked.
 */
create table import_task (
  workspace_id uuid not null references workspace(id),
  project_id uuid not null references project(id) on delete cascade,
  origin text not null,
  task_id uuid not null references task(id) on delete cascade,
  primary key (project_id, origin)
);
alter table import_task enable row level security;
/* The workspace in the key, as every table here; and the row's project is
   its task's, so a row cannot say a task is in a project it is not in. */
create policy it_own on import_task for all to tracker_app
  using (workspace_id = current_workspace() and exists (select 1 from task t where t.id = task_id and t.project_id = import_task.project_id))
  with check (workspace_id = current_workspace() and exists (select 1 from task t where t.id = task_id and t.project_id = import_task.project_id));
grant select, insert on import_task to tracker_app;

/* One import at a time in a workspace, whoever started it: a person sees
   only their own rows, so two owners could each start one. */
create function workspace_importing() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from linear_import where workspace_id = current_workspace() and state = 'running')
$$;
revoke execute on function workspace_importing() from public;
grant execute on function workspace_importing() to tracker_app;

/* And held by the database, not only asked first: two starts at one moment
   both found nothing running. The older of any two running is ended. */
update linear_import i set state = 'failed', error = 'stopped', key_enc = null, finished_at = now()
where i.state = 'running' and exists (
  select 1 from linear_import j
  where j.workspace_id = i.workspace_id and j.state = 'running' and j.created_at > i.created_at);
create unique index linear_import_one_running on linear_import (workspace_id) where state = 'running';
