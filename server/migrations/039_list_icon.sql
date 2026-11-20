/*
 * A list carries its own mark.
 *
 * The ring beside a task was worked out from the list's *name* — "Doing" or
 * "Review" got the half-filled one and everything else got the empty ring —
 * so Doing and In review looked identical, and renaming a list changed what
 * its tasks looked like. A name is the person's to change; what the mark
 * says should not depend on it.
 *
 * A closed set of six, which is one shape filling up plus two endings:
 * open, started, doing, review, done, stopped.
 */
alter table task_list add column icon text not null default 'open';

alter table task_list add constraint task_list_icon_is_real
  check (icon in ('open', 'started', 'doing', 'review', 'done', 'stopped'));

/* What the four defaults were already drawing, said out loud. */
update task_list set icon = case name
  when 'Doing' then 'doing'
  when 'In review' then 'review'
  when 'Done' then 'done'
  else 'open'
end;

/* And anything that finishes work is done, whatever it is called. */
update task_list set icon = 'done' where finishes;
