/*
 * The sweep of actors with no membership left, the seed
 * — stopped at the first one who had written something somewhere that is
 * kept: a colleague whose membership the hourly clear-out had removed, with
 * a comment still in `ours`. It deleted that comment's author and failed on
 * the comment, and the whole check with it. Somebody who wrote something
 * is part of its record, so they are not an orphan.
 */
create or replace function purge_orphan_actors()
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

  /* Not anybody named as the author of something that is still here. */
  for t in
    select table_name::text from information_schema.columns
    where table_schema = 'public' and column_name = 'author_id'
  loop
    execute format('delete from orphan where id in (select author_id from %I)', t);
  end loop;

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
