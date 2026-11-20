-- What a task's description, an announcement and a document say, as plain
-- text, so search finds the words inside them and not only their titles —
-- `docs/specs/palette.md`.
--
-- The same shape as a message's (migration 090): drawn out by the database
-- from the editor's document, so nothing that writes one has to remember
-- to write this, and kept under a trigram index, because an unanchored
-- pattern with no index is a read of every row — ten thousand tasks in one
-- project on the load table.
alter table task add column said text generated always as (words_of(body)) stored;
create index task_said_trgm on task using gin (said gin_trgm_ops) where deleted_at is null;

alter table post add column said text generated always as (words_of(body)) stored;
create index post_said_trgm on post using gin (said gin_trgm_ops) where deleted_at is null;

alter table file add column said text generated always as (words_of(body)) stored;
create index file_said_trgm on file using gin (said gin_trgm_ops) where deleted_at is null;
