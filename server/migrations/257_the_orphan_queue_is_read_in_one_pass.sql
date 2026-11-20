/*
 * The keys queued for removal are checked against what still names them in
 * one pass, not once a key — `docs/api.md`, "It removes the bytes of what is
 * gone".
 *
 * `storage_orphans` took off the queue every key a row still names with
 * `exists (… where f.storage_key = o.key or f.display_key = o.key) or …`.
 * None of those columns has an index and the `or` keeps the planner from
 * turning the tests into a join, so each queued key read the whole of
 * `file`, `project`, `workspace` and `actor`: the queue's length times the
 * four tables. On the development database — twenty-three thousand keys
 * queued by the tests, a hundred thousand workspaces and actors — one call
 * was three and a half minutes, and the server's suite spent most of its
 * ten minutes on the test that makes it.
 *
 * The same rows go, by a join the planner can hash: every key something
 * names, read once, against the queue. What is returned is unchanged.
 */
create or replace function storage_orphans(p_limit int) returns setof text
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from storage_orphan o
  using (
    select storage_key as key from file where storage_key is not null
    union
    select display_key from file where display_key is not null
    union
    select icon_key from project where icon_key is not null
    union
    select icon_key from workspace where icon_key is not null
    union
    select avatar_key from actor where avatar_key is not null
  ) named
  where named.key = o.key;
  return query select key from storage_orphan order by queued_at limit greatest(p_limit, 1);
end $$;
