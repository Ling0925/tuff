/*
 * A seventh mark, and two endings instead of one.
 *
 * A project started with Backlog, Doing, In review, Done. It starts with
 * Backlog, Todo, In Progress, Done, Canceled — the vocabulary people arrive
 * already knowing, rather than the one the board's fixed columns happened to
 * have.
 *
 * Backlog and Todo are both "not started", so they need marks that tell them
 * apart: `backlog` is the ring drawn broken. Two lists with the same mark is
 * exactly the fault `039_list_icon.sql` was written to fix, and defaulting
 * both to `open` would have put it straight back.
 *
 * Nothing here renames anybody's lists. What a project is called inside is
 * the person's, and a migration that edits it is the product overwriting
 * somebody's work to tidy up after itself.
 */
alter table task_list drop constraint task_list_icon_is_real;
alter table task_list add constraint task_list_icon_is_real
  check (icon in ('backlog', 'open', 'started', 'doing', 'review', 'done', 'stopped'));
