/*
 * A sort key is compared byte by byte, whatever the server's locale.
 *
 * Keys are fractional indexes — `fractional-indexing`, base 62 — and their
 * whole meaning is the byte order of "0-9A-Za-z": `Zz` is before `a0`, `V`
 * before `b`. The columns were plain `text`, so they compared in the
 * database's collation. Locally that is Postgres on Alpine, where musl has
 * no locale collation and text compares by bytes, so every test agreed with
 * the keys. The deployed database runs on glibc, `en_US.utf8`, where case
 * is ignored at first and `'Zz' < 'a0'` is false.
 *
 * So the server's idea of a column's order was not the keys' idea of it.
 * Moving a card to the top asked for the first card, got `a0` (to the
 * locale `Zz` comes after it), and was handed `generateKeyBetween(null,
 * 'a0')` = `Zz` — a key the column already had. That is where the five
 * cards at `Zz` came from, which 068 and 069 evened out without knowing
 * why they kept appearing. And where the locale's "next" was below the
 * anchor in byte order, the key could not be made at all and the move
 * failed, so the card went back where it came from.
 *
 * The client sorts by bytes, so nothing anybody sees moves: this brings the
 * server to the order the screen was already drawing. Indexes on these
 * columns are rebuilt by the change of type.
 */
alter table task alter column sort_key type text collate "C";
alter table task_list alter column sort_key type text collate "C";
alter table sidebar_place alter column sort_key type text collate "C";

/*
 * And any key the locale order handed out twice is given back its own, in
 * byte order — the order the screen shows. Only columns that have a shared
 * key are touched; the rest keep theirs. The same function as 068 and 069,
 * for the same reason they share one.
 */
create or replace function pg_temp.order_key(n bigint) returns text as $$
  select case
    when n < 62 then 'a' || substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', (n % 62)::int + 1, 1)
    else 'b'
      || substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', (((n - 62) / 62) % 62)::int + 1, 1)
      || substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', ((n - 62) % 62)::int + 1, 1)
  end
$$ language sql immutable;

with shared as (
  select distinct project_id, list_id from task
  where deleted_at is null and parent_id is null
  group by project_id, list_id, sort_key having count(*) > 1
),
ordered as (
  select t.id,
         row_number() over (partition by t.project_id, t.list_id order by t.sort_key, t.created_at, t.id) - 1 as n
  from task t
  join shared s on s.project_id = t.project_id and s.list_id is not distinct from t.list_id
  where t.deleted_at is null and t.parent_id is null
)
update task t set sort_key = pg_temp.order_key(ordered.n) from ordered where t.id = ordered.id;

with shared as (
  select distinct parent_id from task
  where deleted_at is null and parent_id is not null
  group by parent_id, sort_key having count(*) > 1
),
ordered as (
  select t.id,
         row_number() over (partition by t.parent_id order by t.sort_key, t.created_at, t.id) - 1 as n
  from task t join shared s on s.parent_id = t.parent_id
  where t.deleted_at is null
)
update task t set sort_key = pg_temp.order_key(ordered.n) from ordered where t.id = ordered.id;
