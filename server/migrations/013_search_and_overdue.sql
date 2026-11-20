-- Measured against the load table, two screens were far outside the
-- budget: overdue across every project took 1.2 s and search took 4.2 s. Both
-- were reading every row and discarding most of them.

-- Overdue is a narrow slice of a large table — open, dated, and past. A
-- partial index is the whole answer: it holds only the rows the question is
-- about, so it stays small as the finished work piles up behind it.
create index task_overdue on task (due_on)
  where deleted_at is null and completed_at is null and due_on is not null;

-- Unassigned is the same shape of question.
create index task_unassigned on task (created_at desc)
  where deleted_at is null and completed_at is null and cardinality(assignee_ids) = 0;

-- Search was `ilike '%word%'`, which no ordinary index can help: the pattern
-- is unanchored, so the only plan is to read everything.
--
-- Trigrams are a separate index, which is what the design asks for — it does
-- not yet ask for a separate *engine*, and the endpoint's shape is the same
-- either way, so this can be replaced by one later without the contract
-- moving.
create extension if not exists pg_trgm;

create index task_title_trgm on task using gin (title gin_trgm_ops)
  where deleted_at is null;
create index post_title_trgm on post using gin (title gin_trgm_ops)
  where deleted_at is null;
create index file_name_trgm on file using gin (name gin_trgm_ops)
  where deleted_at is null;
