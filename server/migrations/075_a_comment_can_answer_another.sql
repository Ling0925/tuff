-- A comment can answer another.
--
-- Comments on a task were one flat column, so an answer to the third remark
-- stood under the eighth with nothing saying which it answered. A reply
-- names the comment it answers; one level deep — a reply to a reply answers
-- the same comment, which the server sees to, so a thread is a comment and
-- the answers under it rather than a tree to be read sideways.
-- `docs/specs/comments.md`.
alter table comment add column parent_id uuid references comment(id);
create index comment_answers on comment (parent_id, created_at)
  where parent_id is not null and deleted_at is null;
