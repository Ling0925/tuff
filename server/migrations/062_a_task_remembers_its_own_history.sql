-- A task's own history, read beside the task.
--
-- `GET /api/activity` could filter by actor and by project, each with an
-- index behind it, and by nothing else. The task screen asks a third
-- question — what happened to this one object — and without this that is a
-- scan of every event in the workspace, which on the load table is
-- the whole log for one panel in a column.
--
-- Partial, because an event about a project has no object and there is
-- nothing to look up: `project.create` and the member changes are most of
-- what a busy workspace writes.
create index activity_by_object on activity_event (workspace_id, object_id, at desc)
  where object_id is not null;
