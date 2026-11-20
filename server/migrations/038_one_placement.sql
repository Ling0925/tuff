/*
 * A task is in a list, and that is the whole of where it is.
 *
 * A task had a
 * list, a board column, a free-text group and a completion mark, and three
 * of those were placements. The list and the column could disagree about the
 * same task with no rule about which to believe, and the group was a column
 * nothing has ever written.
 */

/* The column nothing consulted. */
alter table task drop column "group";

/*
 * A list can say that the work in it is finished.
 *
 * Not a name and not a position: both are the person's to change, and a rule
 * that reads either is a rule that breaks the first time somebody renames
 * "Done" to "Shipped" or drags it up the board.
 */
alter table task_list add column finishes boolean not null default false;

/*
 * Four lists to start with, in every project that does not have them.
 *
 * Named after the columns they replace, so a board looks the same the
 * morning after as it did the night before.
 */
insert into task_list (id, workspace_id, project_id, author_id, name, sort_key, finishes)
select gen_random_uuid(), p.workspace_id, p.id,
       /* A project has no author of its own, and a list must have one.
          Whoever was put on the project first, and the owner if it is empty
          — the closest true answer to "who made this". */
       coalesce(
         (select pm.actor_id from project_member pm
          where pm.project_id = p.id and pm.deleted_at is null
          order by pm.created_at limit 1),
         (select m.actor_id from membership m
          where m.workspace_id = p.workspace_id and m.role = 'owner' and m.deleted_at is null
          order by m.created_at limit 1)
       ),
       v.name, v.key, v.finishes
from project p
cross join (values
  ('Backlog', 'a0', false),
  ('Doing', 'a1', false),
  ('In review', 'a2', false),
  ('Done', 'a3', true)
) as v(name, key, finishes)
where p.deleted_at is null
  and not exists (
    select 1 from task_list l
    where l.project_id = p.id and l.name = v.name and l.deleted_at is null
  );

/*
 * Every task moves to the list matching the column it was in.
 *
 * Lossy on purpose and only once: a task with both a list and a column keeps
 * the column, because the four defaults are the stages and that is what the
 * columns were. The named list it was in survives as a list — its tasks do
 * not. There is no way to keep both without keeping two placements.
 */
update task t set list_id = l.id
from task_list l
where l.project_id = t.project_id
  and l.deleted_at is null
  and l.name = case coalesce(t.column_name, 'Unsorted')
    when 'Unsorted' then 'Backlog'
    when 'Doing' then 'Doing'
    when 'Review' then 'In review'
    when 'Done' then 'Done'
    else 'Backlog'
  end
  and t.deleted_at is null;

/* Anything already ticked belongs in the list that finishes, whatever column
   it was sitting in — the two could disagree, and this is the last moment
   they are allowed to. */
update task t set list_id = l.id
from task_list l
where l.project_id = t.project_id and l.finishes and l.deleted_at is null
  and t.completed_at is not null and t.deleted_at is null;

alter table task drop column column_name;

/*
 * The list writes the timestamp.
 *
 * `completed_at` stays because *when* is a fact a list cannot hold, and
 * because every query that asks `completed_at is null` — overdue, the open
 * count, the partial index behind both — goes on working untouched.
 */
create function task_finished_follows_list() returns trigger
language plpgsql as $$
declare finishing boolean;
begin
  if new.list_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.list_id is not distinct from old.list_id then
    return new;
  end if;
  select finishes into finishing from task_list where id = new.list_id;
  if finishing is true and new.completed_at is null then
    new.completed_at := now();
  elsif finishing is not true and new.completed_at is not null then
    new.completed_at := null;
  end if;
  return new;
end $$;

create trigger task_finished_follows_list
  before insert or update of list_id on task
  for each row execute function task_finished_follows_list();

/* Its parts go where it goes, which was the column rule and is now the list
   rule. Replaces the one migration 037 wrote for lists and columns both. */
create index task_by_list on task (list_id, sort_key) where deleted_at is null;
