-- A cycle is a named stretch of dates a task can be put into.
--
-- Shaped on `task_list` rather than on anything new: a name, a project, the
-- usual timestamps, and tasks pointing at it. It is a service record, not a
-- fifth entity refuses one, and this is a property of a task
-- that had not been recognised yet.
--
-- Deliberately not Linear's cycle. There a cadence is configured, the next
-- fifteen are generated in advance, and unfinished work rolls over on its
-- own. That is a scheduling engine and five concepts to express one; the
-- design cancels the Linear-shaped tracker and asks for fewer concepts, not
-- fewer capabilities. Here somebody writes a name and two dates.
create table cycle (
  id uuid primary key,
  workspace_id uuid not null references workspace(id),
  project_id uuid not null references project(id),
  author_id uuid not null references actor(id),
  -- Carried because the shared policy below reads it on every row, the same
  -- as the four and the things that hang off them.
  visible_to_client boolean not null default false,
  name text not null,
  -- Dates with no rule attached: nothing starts, nothing closes, nothing is
  -- enforced. They are what the cycle is called by and what sorts it.
  starts_on date not null,
  ends_on date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- The workspace is in the key, as it is in every other index here: a query
-- that forgets it returns nothing rather than two companies.
create index cycle_by_project on cycle (workspace_id, project_id, starts_on desc)
  where deleted_at is null;

-- Null is the ordinary state, not an unanswered question: most work in a
-- Basecamp-shaped product is not in a sprint.
alter table task add column if not exists cycle_id uuid references cycle(id);
create index task_by_cycle on task (workspace_id, cycle_id)
  where cycle_id is not null and deleted_at is null;

alter table cycle enable row level security;

-- The same shape the four share — read what the project lets you read,
-- write only into a project you are in, as yourself.
create policy o_read on cycle for select
  using (can_read_object(workspace_id, project_id, visible_to_client));
create policy o_write on cycle for insert
  with check (in_project(project_id) and author_id = current_actor());
create policy o_update on cycle for update
  using (can_read_object(workspace_id, project_id, visible_to_client))
  with check (true);

grant select, insert, update on cycle to tracker_app;
