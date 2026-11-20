/*
 * A word on a task.
 *
 * A service record and not a fifth entity: nothing is filed under a label
 * except by the tasks that carry it. Per workspace rather than per project,
 * because a word that means the same thing in three projects is the whole
 * reason to have one.
 */
create table label (
  id uuid primary key,
  workspace_id uuid not null references workspace(id),
  name citext not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index label_name_in_workspace on label (workspace_id, name)
  where deleted_at is null;

/*
 * Which tasks carry which, with the workspace on the row.
 *
 * The id is in every key and index — security is schema, not middleware — and
 * a join table that has to reach through two tables to find out whose row it
 * is cannot be bounded by a policy cheaply.
 */
create table task_label (
  id uuid primary key,
  workspace_id uuid not null references workspace(id),
  task_id uuid not null references task(id),
  label_id uuid not null references label(id),
  created_at timestamptz not null default now()
);
create unique index task_label_once on task_label (task_id, label_id);
create index task_label_by_label on task_label (label_id);

alter table label enable row level security;
alter table task_label enable row level security;

/* The workspace you are in, and nothing else. */
create policy label_in_workspace on label for all to tracker_app
  using (workspace_id in (select staff_workspaces())
         and (current_workspace() is null or workspace_id = current_workspace()))
  with check (workspace_id in (select staff_workspaces())
              and (current_workspace() is null or workspace_id = current_workspace()));

/*
 * And a task_label row is visible exactly when its task is.
 *
 * Asked of `visible_projects()` through the task rather than of the workspace
 * alone: a client who may see one project must not learn which labels are on
 * a task in another.
 */
create policy task_label_with_task on task_label for all to tracker_app
  using (exists (select 1 from task t
                 where t.id = task_label.task_id and t.project_id in (select visible_projects())))
  with check (exists (select 1 from task t
                      where t.id = task_label.task_id and t.project_id in (select visible_projects())));

grant select, insert, update, delete on label to tracker_app;
grant select, insert, delete on task_label to tracker_app;
