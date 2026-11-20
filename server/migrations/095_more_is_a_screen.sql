/*
 * `more` is a screen now — a phone's More tab, at `/:ws/more`
 *  — so it stands where a project's slug would and is
 * refused as one, like the six before it. `web/src/data/route.ts` holds the
 * same seven.
 */

/* A project already called `more` steps aside to the next free name first,
   so nothing in the table is left holding a word the check now refuses. */
do $$
declare row record;
begin
  for row in select id, workspace_id from project where slug = 'more' loop
    update project p set slug = (
      select 'more-' || n from generate_series(2, 1000) n
      where not exists (
        select 1 from project o
        where o.workspace_id = row.workspace_id and o.slug = ('more-' || n)::citext
      )
      order by n limit 1
    ) where p.id = row.id;
  end loop;
end $$;

create or replace function is_a_screen(said text) returns boolean
language sql immutable strict as $$
  select said in ('notifications', 'members', 'chat', 'settings', 'search', 'projects', 'more')
$$;
