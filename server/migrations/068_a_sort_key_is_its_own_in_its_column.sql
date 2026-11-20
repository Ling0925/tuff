/*
 * A card's key has to be its own, inside its column.
 *
 * Making a task read the topmost key in the whole *project* and placed the
 * new one above it, so every column gave the same answer: a task made in
 * each of ten columns got the same `sort_key` in all ten. Measured on this
 * data before the fix — one key shared by ten cards in ten different
 * columns, and the four keys under it the same.
 *
 * Inside a single column that was invisible, because the collisions were
 * all in other columns. Carrying a card into one of them is what shows it:
 * the card arrives holding a key another card already has, the order
 * between two equal keys is whatever the planner returns, and the card
 * lands somewhere nobody put it. It could never be reproduced on a freshly
 * seeded board, because a seed writes its keys in one pass and does not
 * collide — which is why it looked like a fault of the server rather than
 * of the data.
 *
 * `tasks.ts` now reads the edge of the column it is inserting into. This is
 * for the rows already written.
 *
 * The keys are the ones `fractional-indexing` itself would produce for a
 * run of cards — `a0`…`az`, then `b00`…`b0z`, `b10` and so on — because
 * anything else is refused as an anchor the next time a card is dragged
 * between two of them. The formula below was checked against the library's
 * own output for 200 consecutive keys before it was written here.
 *
 * Order is preserved: within each column the cards are taken as they are
 * drawn today, with the creation time and the id breaking ties the same way
 * every time. Nothing visibly moves. What changes is that the order stops
 * depending on which row came back first.
 */
create or replace function pg_temp.order_key(n bigint) returns text as $$
  /* The library's alphabet, and its two ranges. `n` counts from 0. */
  select case
    when n < 62 then 'a' || substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', (n % 62)::int + 1, 1)
    else 'b'
      || substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', (((n - 62) / 62) % 62)::int + 1, 1)
      || substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', ((n - 62) % 62)::int + 1, 1)
  end
$$ language sql immutable;

with ordered as (
  select
    t.id,
    row_number() over (
      partition by t.project_id, t.list_id
      order by t.sort_key, t.created_at, t.id
    ) - 1 as n
  from task t
  where t.deleted_at is null and t.parent_id is null
)
update task t
set sort_key = pg_temp.order_key(ordered.n)
from ordered
where t.id = ordered.id;

/* And the parts, ordered among their siblings rather than in a column. The
   edge was already read per parent there, so this is an evening-out rather
   than a repair — but two parts of one task sharing a key would read the
   same way, and the cost of ruling it out is this paragraph. */
with ordered as (
  select
    t.id,
    row_number() over (
      partition by t.parent_id
      order by t.sort_key, t.created_at, t.id
    ) - 1 as n
  from task t
  where t.deleted_at is null and t.parent_id is not null
)
update task t
set sort_key = pg_temp.order_key(ordered.n)
from ordered
where t.id = ordered.id;
