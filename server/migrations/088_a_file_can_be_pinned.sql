-- A file kept at the head of a project's Docs — `docs/specs/docs.md`.
-- For everybody on the project: a pin is the team saying "start here".
alter table file add column pinned_at timestamptz;
alter table file add column pinned_by uuid references actor(id);
