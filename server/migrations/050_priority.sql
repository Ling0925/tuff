/*
 * How urgent a task is, as a word.
 *
 * The declaration order is the sort order: `order by priority nulls last`
 * puts urgent first and the tasks nobody has triaged last, which is the whole
 * rule.
 */
create type task_priority as enum ('urgent', 'high', 'medium', 'low');

alter table task add column priority task_priority;

/*
 * Null is most of the table, so it is left out of the index.
 *
 * The load table is 10 000 tasks in a project and a handful of them
 * are ever urgent; an index over the nulls would be an index over the answer
 * nobody is asking for.
 */
create index task_by_priority on task (project_id, priority)
  where deleted_at is null and priority is not null;
