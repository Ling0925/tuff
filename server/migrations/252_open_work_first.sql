/*
 * A project's tasks are read open work first, then what is finished, each
 * in its own order — `GET /api/projects/:id/tasks`, `docs/api.md`. The
 * index the page walks, so the first five hundred stop early as they did
 * on `sort_key` alone (`task_by_project`, migration 001).
 */
create index task_open_first on task (project_id, (completed_at is not null), sort_key, id) where deleted_at is null;
