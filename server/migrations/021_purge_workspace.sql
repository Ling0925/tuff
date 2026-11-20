-- Removing one workspace outright, for the throwaway ones.
--
-- Every run of `pnpm check` seeds a fresh studio and leaves it behind, so the
-- database grows by a workspace a run and the server tests go from seconds to
-- minutes. A check that takes minutes is a check people skip, and then
-- nothing else in the backlog works either.
--
-- The same sweep the load script was doing inline, put where both can reach
-- it. Tables are found rather than listed: an order written out by hand goes
-- stale the first time a table is added, and it goes stale silently.
create function purge_workspace(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  todo text[];
  left_over text[];
  t text;
  moved boolean;
begin
  select array_agg(table_name::text) into todo
  from information_schema.columns
  where table_schema = 'public' and column_name = 'workspace_id';

  loop
    moved := false;
    left_over := '{}';
    foreach t in array todo loop
      begin
        execute format('delete from %I where workspace_id = $1', t) using p_id;
        moved := true;
      exception when foreign_key_violation then
        -- A child that still points at something. Try it again next pass,
        -- once whatever holds it has gone.
        left_over := left_over || t;
      end;
    end loop;
    todo := left_over;
    exit when cardinality(todo) = 0;
    if not moved then
      raise exception 'could not clear workspace %: %', p_id, todo;
    end if;
  end loop;

  delete from workspace where id = p_id;
end $$;

/*
 * The accounts those workspaces belonged to.
 *
 * An actor outlives a workspace and what hangs off one is not addressed by
 * workspace at all — a sign-in session and an account row are about the
 * person. Left behind, they are rows nothing can reach and nobody deletes.
 */
create function purge_orphan_actors()
returns integer language plpgsql security definer set search_path = public as $$
declare
  todo text[];
  left_over text[];
  t text;
  moved boolean;
  n integer;
begin
  create temporary table orphan on commit drop as
  select a.id from actor a
  where not exists (select 1 from membership m where m.actor_id = a.id);

  select count(*) into n from orphan;
  if n = 0 then return 0; end if;

  select array_agg(table_name::text) into todo
  from information_schema.columns
  where table_schema = 'public' and column_name = 'actor_id';

  loop
    moved := false;
    left_over := '{}';
    foreach t in array todo loop
      begin
        execute format('delete from %I where actor_id in (select id from orphan)', t);
        moved := true;
      exception when foreign_key_violation then
        left_over := left_over || t;
      end;
    end loop;
    todo := left_over;
    exit when cardinality(todo) = 0;
    if not moved then
      raise exception 'could not clear actors: %', todo;
    end if;
  end loop;

  delete from actor where id in (select id from orphan);
  return n;
end $$;

grant execute on function purge_workspace, purge_orphan_actors to tracker_app;
