/*
 * A list's mark can be given a colour.
 *
 * The mark says how far round the ring the work in it has gone, and its
 * colour was worked out from that: a stage was the accent, an ending was
 * grey. That is a good default and a poor rule — a team with five lists in
 * Doing has five identical blue rings, and the one thing they would reach
 * for to tell them apart was not theirs to change.
 *
 * Null keeps the old behaviour rather than meaning "no colour", so the four
 * lists a project starts with look exactly as they did.
 */
alter table task_list add column color text;

/*
 * The ten the product already has: the tints a project's tile and a person's
 * avatar are drawn in. Named rather than stored as hex, so the palette can be
 * retuned — it brightens in the dark theme already — without rewriting rows,
 * and so the contract says something a person reading it can picture.
 */
alter table task_list add constraint task_list_color_is_real
  check (color is null or color in (
    'red', 'orange', 'yellow', 'green', 'teal',
    'blue', 'indigo', 'purple', 'pink', 'grey'
  ));
