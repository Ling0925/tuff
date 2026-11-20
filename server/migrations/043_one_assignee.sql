/*
 * A task is somebody's.
 *
 * It held a list of people, because the design asked for several and the
 * column was built to match. In a year of using tools shaped like this one
 * the several is almost always one, and the list costs something on every
 * screen that draws it: a column wide enough for three faces, a picker that
 * is a set rather than a choice, and the question "who is doing this?"
 * answered with a crowd.
 *
 * The design is changed in the same commit rather than quietly disagreed
 * with — it is the source of truth for the product, and a column that stops
 * matching it is the thing this repository spends its time finding.
 *
 * **Lossy once.** A task with two people keeps the first: the array has an
 * order, it is the order they were put in, and the first is the one who was
 * asked. There is no way to keep both without keeping the list.
 */
alter table task add column assignee_id uuid references actor(id);

update task set assignee_id = assignee_ids[1] where cardinality(assignee_ids) > 0;

/* The indexes that read the list, in the shape the question now has.
   Assigned to me is an equality rather than an array containment, so this
   is a plain index and not a gin one. */
drop index task_by_assignee;
drop index task_unassigned;

alter table task drop column assignee_ids;

create index task_by_assignee on task (assignee_id, due_on)
  where deleted_at is null and completed_at is null;

create index task_unassigned on task (created_at desc)
  where deleted_at is null and completed_at is null and assignee_id is null;
