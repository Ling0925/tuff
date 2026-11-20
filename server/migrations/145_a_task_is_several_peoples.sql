/*
 * A task can be given to several people.
 *
 * It was one person since 043, by decision, and that decision is reversed
 * by ours: two-way sync with GitHub Issues
 * meets issues with several people on them, and a task that can only hold
 * one of them drops the rest every time it is written back.
 *
 * A list again, in the order people were put on it: the first is who was
 * asked first, which is what a screen with room for one face shows.
 *
 * `assignee_id` stays, worked out from the list and never written. The
 * apps already in people's hands read it on every task, and an answer they
 * can still decode is the difference between an update they need and one
 * they can take when they like. It is the first of the list and nothing
 * else: whether a task is somebody's is always asked of the list.
 */
alter table task add column assignee_ids uuid[] not null default '{}';

update task set assignee_ids = array[assignee_id] where assignee_id is not null;

drop index task_by_assignee;
drop index task_unassigned;
drop index task_by_assignee_any;
drop index task_unassigned_in;

alter table task drop column assignee_id;
alter table task add column assignee_id uuid generated always as (assignee_ids[1]) stored;

/* Nobody twice, and not a crowd: past ten it is a project, not a task. A
   check cannot hold a query, so the counting is a function's. */
create function ids_distinct(p uuid[]) returns boolean
language sql immutable set search_path = public as $$
  select count(distinct x) = cardinality(p) from unnest(p) x
$$;
alter table task add constraint task_assignees_fit check (
  cardinality(assignee_ids) <= 10 and ids_distinct(assignee_ids)
);

/* Assigned to me is a containment now, so the index is a gin one: open
   work for My tasks and the reminders, and all of it for a person's page. */
create index task_by_assignee on task using gin (assignee_ids)
  where deleted_at is null and completed_at is null;
create index task_by_assignee_any on task using gin (assignee_ids)
  where deleted_at is null;
create index task_unassigned_in on task (workspace_id, created_at desc)
  where deleted_at is null and completed_at is null and assignee_ids = '{}';

/*
 * The reminders go to everybody on it — 128's, with the person taken from
 * the list rather than the one column there was.
 */
create or replace function claim_due_reminders() returns table (
  workspace_id uuid, actor_id uuid, task_id uuid, kind text, due_on date
)
language sql volatile security definer set search_path = public as $$
  with here as (
    select t.workspace_id, x.actor_id, t.id as task_id, t.due_on,
           (now() at time zone coalesce(u.timezone, 'UTC')) as local
    from task t
    cross join lateral unnest(t.assignee_ids) as x(actor_id)
    join app_user u on u.actor_id = x.actor_id
    join membership m on m.workspace_id = t.workspace_id and m.actor_id = x.actor_id
      and m.deleted_at is null and m.joined_at is not null
    join project p on p.id = t.project_id and p.deleted_at is null
    where t.deleted_at is null and t.completed_at is null and t.due_on is not null
      and t.due_on between current_date - 2 and current_date + 2
  ),
  due as (
    select h.workspace_id, h.actor_id, h.task_id, h.due_on,
           case when h.local::date = h.due_on - 1 then 'soon'
                when h.local::date = h.due_on + 1 then 'late' end as kind
    from here h
    where h.local::time >= time '09:00'
  )
  insert into due_reminder (workspace_id, task_id, actor_id, due_on, kind)
  select d.workspace_id, d.task_id, d.actor_id, d.due_on, d.kind from due d where d.kind is not null
  on conflict do nothing
  returning due_reminder.workspace_id, due_reminder.actor_id, due_reminder.task_id,
            due_reminder.kind, due_reminder.due_on
$$;
grant execute on function claim_due_reminders to tracker_app;
