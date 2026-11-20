/*
 * A board reads each list on its own, the head first and the rest as
 * somebody scrolls down it — `GET /api/projects/:id/tasks?by=list` and
 * `?list=`. What a column draws is the tasks
 * in it that are not parts, in `sort_key` then `id`; this is the index that
 * page walks and the count of the column's head reads, so neither steps
 * over a list's parts to find its cards (`task_by_list`, migration 038,
 * holds both).
 */
create index task_top_by_list on task (list_id, sort_key, id) where deleted_at is null and parent_id is null;
