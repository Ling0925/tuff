/*
 * A project's Files read a page at a time,
 *
 * The list's own order, as an index: pinned first (the latest pin at the
 * top), then the latest change, then the id, which two rows written in one
 * transaction share nothing else of. A page is read from the head of it and
 * the read stops once it has a page, so the read policy is asked about a
 * hundred and some rows rather than every row of the project — four
 * thousand on the load table, each kept document and held picture asking a
 * question of its own.
 *
 * Changes no rows.
 */

create index file_listed on file (project_id, pinned_at desc nulls last, updated_at desc, id desc)
  where deleted_at is null;
