/*
 * What an AI tool spent on a task.
 *
 * Kept beside the hours and shaped like them: a number somebody's client
 * wrote about a task, more than one per task, read with the task and
 * summed per project. Not a fifth entity: no address, no body, nothing to
 * open.
 *
 * Its own table, not columns on `time_entry`: an hour with no minutes
 * breaks every client decoding `minutes`, and a token count has no day.
 *
 * Cascades from the task and the project, so a project that goes for good
 * (`purge_project_rows`) takes its lines without being told about them.
 * The workspace's and the account's clear-outs find it by its columns.
 */
create table task_spend (
  id uuid primary key,
  workspace_id uuid not null references workspace(id),
  project_id uuid not null references project(id) on delete cascade,
  task_id uuid not null references task(id) on delete cascade,
  actor_id uuid not null references actor(id),
  client text not null check (length(client) between 1 and 60),
  model text check (length(model) between 1 and 100),
  tokens bigint not null check (tokens >= 0),
  cost_usd numeric(14, 6) check (cost_usd >= 0),
  /* The client's own id for the run: reported again, it replaces. */
  session text check (length(session) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (tokens > 0 or cost_usd > 0)
);

/* A task's lines, by its id rather than by a pair with an enum in it —
   `120_a_screen_costs_what_it_shows.sql` says why. */
create index task_spend_on on task_spend (task_id, created_at) where deleted_at is null;
create index task_spend_by_project on task_spend (project_id) where deleted_at is null;
/* One line a session: the report after the next reply replaces it. */
create unique index task_spend_once on task_spend (task_id, actor_id, client, session)
  where session is not null and deleted_at is null;

create trigger touch before update on task_spend
  for each row execute function touch_updated_at();

alter table task_spend enable row level security;
create policy ts_read on task_spend for select using (
  workspace_id = current_workspace() and project_id in (select visible_projects()));
create policy ts_write on task_spend for insert with check (
  workspace_id = current_workspace() and project_id in (select visible_projects())
  /* And on a task of that project, so a line cannot name one place and sit in another. */
  and exists (select 1 from task t where t.id = task_id and t.project_id = task_spend.project_id));
create policy ts_update on task_spend for update using (
  workspace_id = current_workspace() and project_id in (select visible_projects()));
grant select, insert, update on task_spend to tracker_app;
