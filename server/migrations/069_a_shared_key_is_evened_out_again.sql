/*
 * The same evening-out as 068, run again.
 *
 * 068 gave every card its own key within its column, and recorded itself
 * applied — truthfully. What it could not reach was rows that collided
 * AFTER it: cards made by the old creation code and carried into one
 * column by the old move code, which re-keyed nothing. On the deployed
 * board five cards in one column sat at `Zz` and two more at `a0` with
 * 068 already in `schema_migration`, and a drop that named no place
 * (`after: null`) changed no key, so the card settled wherever the planner
 * put the equal keys on the next read.
 *
 * The move handler now re-keys any card whose key is shared in its column,
 * so this cannot recur through it. This pass is for what is already there.
 * Identical body to 068 — identical on purpose, so there is one known-good
 * shape of this operation and not two that drift.
 */
create or replace function pg_temp.order_key(n bigint) returns text as $$
  select case
    when n < 62 then 'a' || substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', (n % 62)::int + 1, 1)
    else 'b'
      || substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', (((n - 62) / 62) % 62)::int + 1, 1)
      || substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', ((n - 62) % 62)::int + 1, 1)
  end
$$ language sql immutable;

with ordered as (
  select t.id,
         row_number() over (partition by t.project_id, t.list_id order by t.sort_key, t.created_at, t.id) - 1 as n
  from task t where t.deleted_at is null and t.parent_id is null
)
update task t set sort_key = pg_temp.order_key(ordered.n) from ordered where t.id = ordered.id;

with ordered as (
  select t.id,
         row_number() over (partition by t.parent_id order by t.sort_key, t.created_at, t.id) - 1 as n
  from task t where t.deleted_at is null and t.parent_id is not null
)
update task t set sort_key = pg_temp.order_key(ordered.n) from ordered where t.id = ordered.id;
