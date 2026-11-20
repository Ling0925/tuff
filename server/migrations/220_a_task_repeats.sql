/*
 * A task can repeat.
 *
 * A field, not a fifth entity and not a series table: the open task of a
 * series carries the rule, and finishing it makes the next one and hands
 * the rule on. `repeat_next_id` is the one it made, kept on the finished
 * task so that reopening it can take that one back rather than leave two
 * open copies.
 *
 * The rule's shape — `{ every, interval?, weekdays?, day?, month?, from? }`
 * — is the schema's (`shared-schema/src/repeat.ts`) and the endpoint's to
 * check; here only that it is an object, and never on a part, whose steps
 * are copied with the task they belong to.
 */
alter table task
  add column repeat jsonb
    check (repeat is null or jsonb_typeof(repeat) = 'object'),
  /* Set null when the clear-out takes the next one for good: the link is a
     convenience for undoing, and nothing else reads it. */
  add column repeat_next_id uuid references task(id) on delete set null,
  add constraint task_repeat_not_on_a_part check (repeat is null or parent_id is null);
