/*
 * A document's colour and glyph are chosen, the way a project's mark is —
 * `docs/specs/docs.md`, "A document's mark", and the project mark spec.
 *
 * Both null means the document looks as every document did: the doc glyph
 * on the accent. Nothing is backfilled. The glyph is checked by the API
 * against `MarkIcon`; here only its shape, as `project` has it.
 */
alter table file
  add column mark_icon text,
  add column mark_tint smallint;

alter table file
  add constraint file_mark_tint_range
    check (mark_tint is null or mark_tint between 0 and 9),
  add constraint file_mark_icon_short
    check (mark_icon is null or length(mark_icon) between 1 and 20);
