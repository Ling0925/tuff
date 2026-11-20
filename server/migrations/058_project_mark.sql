/*
 * A project's mark is chosen, not only derived.
 *
 * Derived from the id is the right default: two projects called "Website"
 * and "Website redesign" get the same initials and the same first letter,
 * and a hash gives them different marks without anybody choosing. It is the
 * wrong ceiling — the person looking at these nine rows all day is the one
 * who knows which should be the red one.
 *
 * Both null means "whatever the id says", so nothing has to be backfilled
 * and a project that is never touched keeps the mark it has always had.
 */
alter table project
  add column mark_icon text,
  add column mark_tint smallint;

-- The ten tints are an index into the theme, so the column holds an index.
-- The glyph names are checked by the API against `MarkIcon`; what is held
-- here is the shape of the thing — short, and one of a small set — because a
-- column a client can write a kilobyte into is a column a client will.
alter table project
  add constraint project_mark_tint_range
    check (mark_tint is null or mark_tint between 0 and 9),
  add constraint project_mark_icon_short
    check (mark_icon is null or length(mark_icon) between 1 and 20);
