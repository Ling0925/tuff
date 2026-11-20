/*
 * A task can hold tasks, and the checklist becomes the way it does.
 *
 * `task_step`
 * and a subtask were two ways to break a task into parts, and the person
 * writing one would have had to choose with no rule to choose by. A subtask
 * is a task, so every question about it is already answered — it has an
 * assignee, a date, an address, comments and a soft delete because that is
 * what a task has.
 */

alter table task add column parent_id uuid references task(id);

/* The parent's parts, in order, the way the list draws them. */
create index task_by_parent on task (parent_id, sort_key) where deleted_at is null;

/*
 * Every step becomes a subtask of the task it was in.
 *
 * It keeps its title, its tick and its place. The author is the parent's
 * author: a step had none, and the task it belonged to is the closest true
 * answer. `decided_at` follows the step's own updates so the board's age is
 * not reset for work that has been sitting.
 */
insert into task (id, workspace_id, project_id, author_id, parent_id, list_id,
                  title, sort_key, completed_at, decided_at, created_at, updated_at,
                  deleted_at, column_name, "group")
select s.id, s.workspace_id, t.project_id, t.author_id, t.id, t.list_id,
       s.title, s.sort_key, s.done_at, s.updated_at, s.created_at, s.updated_at,
       s.deleted_at, t.column_name, t."group"
from task_step s
join task t on t.id = s.task_id;

drop index if exists task_step_by_task;
drop policy ts_read on task_step;
drop policy ts_write on task_step;
drop policy ts_update on task_step;
drop table task_step;

/*
 * One level, refused in the database.
 *
 * The endpoint checks too, but a rule that lives only in a controller is a
 * rule the next way in does not have. Arbitrary nesting turns a list into a
 * tree, and a tree needs collapsing, indentation rules and a decision about
 * what a date on a branch means — none of which anybody asked for.
 *
 * Also refused: a parent in another project, which would put a row in a list
 * nobody on that project can see, and a task as its own parent.
 */
create function task_parent_is_flat() returns trigger
language plpgsql as $$
declare p record;
begin
  if new.parent_id is null then
    return new;
  end if;
  if new.parent_id = new.id then
    raise exception 'a task cannot be its own parent';
  end if;
  select parent_id, project_id into p from task where id = new.parent_id;
  if not found then
    raise exception 'no such parent';
  end if;
  if p.parent_id is not null then
    raise exception 'a subtask cannot have subtasks';
  end if;
  if p.project_id <> new.project_id then
    raise exception 'a parent belongs to another project';
  end if;
  return new;
end $$;

create trigger task_parent_is_flat
  before insert or update of parent_id, project_id on task
  for each row execute function task_parent_is_flat();

/*
 * Deleting a parent takes its parts with it.
 *
 * They are parts of it: left behind they are orphans in the list, which is
 * how a delete becomes a mess somebody finds a week later. Soft, like every
 * other delete here, and reversible until the clear-out.
 */
create function task_delete_reaches_parts() returns trigger
language plpgsql as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    update task set deleted_at = new.deleted_at
    where parent_id = new.id and deleted_at is null;
  elsif new.deleted_at is null and old.deleted_at is not null then
    update task set deleted_at = null
    where parent_id = new.id and deleted_at = old.deleted_at;
  end if;
  return new;
end $$;

create trigger task_delete_reaches_parts
  after update of deleted_at on task
  for each row execute function task_delete_reaches_parts();
