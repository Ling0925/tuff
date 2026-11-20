/*
 * A label belongs to its project.
 *
 * It belonged to the workspace, on the argument that the point of a label is
 * a word meaning the same thing in three projects. The person who owns the
 * product decided the other way: each project keeps its own vocabulary, and
 * a new one starts with a sensible one. A design studio's "Client feedback"
 * has no business in the picker of the team's own backlog.
 *
 * Nothing disappears on the way. Every project gets a copy of every label its
 * workspace had, same name and colour, and every task is re-pointed at its
 * own project's copy — so each picker opens on the words it had yesterday,
 * and from here they can drift apart.
 */
alter table label add column project_id uuid references project(id);

/* One name once per workspace no longer — the copies below share names
   across projects by design. Dropped first, or they collide with it. */
drop index label_name_in_workspace;

create temporary table label_copy on commit drop as
  select l.id as old_id, gen_random_uuid() as new_id, p.id as project_id,
         l.workspace_id, l.name, l.color, l.created_at
  from label l
  join project p on p.workspace_id = l.workspace_id
  where l.deleted_at is null and l.project_id is null;

insert into label (id, workspace_id, project_id, name, color, created_at, updated_at)
select new_id, workspace_id, project_id, name, color, created_at, now() from label_copy;

update task_label tl set label_id = c.new_id
from task t, label_copy c
where t.id = tl.task_id and c.old_id = tl.label_id and c.project_id = t.project_id;

/* The workspace's own rows are done with. Soft, like every removal here. */
update label set deleted_at = now(), updated_at = now()
where project_id is null and deleted_at is null;

/* A live label is always some project's. */
alter table label add constraint label_has_a_project
  check (deleted_at is not null or project_id is not null);

/* One name once per project. */
create unique index label_name_in_project on label (project_id, name)
  where deleted_at is null;
create index label_by_project on label (workspace_id, project_id)
  where deleted_at is null;

/*
 * Seen by whoever may see the project, and only from inside the workspace
 * the session is in — staff only, as before: a client reads the words on a
 * task through the task, not the vocabulary behind them.
 */
drop policy label_in_workspace on label;
create policy label_in_project on label for all to tracker_app
  using (workspace_id in (select staff_workspaces())
         and (current_workspace() is null or workspace_id = current_workspace())
         and project_id in (select visible_projects()))
  with check (workspace_id in (select staff_workspaces())
              and (current_workspace() is null or workspace_id = current_workspace())
              and project_id in (select visible_projects()));

/*
 * What a project starts with: Bug in red, Feature in blue, Improvement in
 * purple — the three the workspace used to start with, now given to every
 * project as it is made. A trigger and not a line in each place that makes
 * a project (the endpoint, a copy as template, an import, the seeds): a
 * project made by a path nobody remembered would start with an empty picker.
 */
create or replace function starting_labels_for_project() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into label (id, workspace_id, project_id, name, color)
  select gen_random_uuid(), new.workspace_id, new.id, name, color
  from (values ('Bug', 'red'), ('Feature', 'blue'), ('Improvement', 'purple'))
    as starting(name, color)
  on conflict (project_id, name) where deleted_at is null do nothing;
  return new;
end $$;

create trigger project_starts_with_labels after insert on project
  for each row execute function starting_labels_for_project();

/* A new workspace no longer gets labels of its own: its first project does. */
create or replace function starting_labels(p_workspace_id uuid) returns void
language plpgsql as $$ begin end $$;
