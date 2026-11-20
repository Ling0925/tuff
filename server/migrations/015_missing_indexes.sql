-- Questions a screen asks that nothing was answering.
--
-- Found while clearing the load workspace, which took minutes and then hours.
-- `message.parent_id` references `message(id)` with no index behind it, so
-- removing one message scanned the whole million-row table to check that
-- nothing pointed at it. Production soft-deletes and never hits that path,
-- which is exactly why it went unnoticed — but the *same missing index* is
-- the read behind opening a thread, and that path is walked constantly.
--
-- The rest are the same shape: a child read by its parent, every time the
-- parent is opened. This is not an "index every foreign key" pass — half the
-- foreign keys in this schema have no query behind them and an index nobody
-- reads is a write nobody asked for.

/*
 * Opening a thread: the replies to one message.
 *
 * Deliberately not partial, unlike every other index in this schema. A
 * partial index cannot answer a referential integrity check — that check is
 * `where $1 = parent_id` with no predicate the planner can match against
 * `deleted_at is null`, so it falls back to a sequential scan and the index
 * looks present while doing nothing. Written partial first, and a 5 000-row
 * delete still took minutes; that is how it was caught.
 */
create index message_by_parent on message (parent_id, created_at);

/* A task's checklist, read with every task. */
create index task_step_by_task on task_step (task_id, sort_key)
  where deleted_at is null;

/* A project's channels, read on the way into chat. */
create index conversation_by_project on conversation (project_id)
  where project_id is not null and deleted_at is null;

/* A project's task lists, read before the tasks in them. */
create index task_list_by_project on task_list (project_id, sort_key)
  where deleted_at is null;

/* Hours on a project, which is how they are reported. */
create index time_entry_by_project on time_entry (project_id, spent_on)
  where deleted_at is null;
