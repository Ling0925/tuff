/*
 * `account` is a screen now — a person's own settings, at `/:ws/account`,
 * apart from the workspace's — so it stands where
 * a project's slug would and is refused as one, as the eight before it are.
 */
do $$
declare row record;
begin
  for row in select id, workspace_id from project where slug = 'account' loop
    update project p set slug = (
      select 'account-' || n from generate_series(2, 1000) n
      where not exists (
        select 1 from project o
        where o.workspace_id = row.workspace_id and o.slug = ('account-' || n)::citext
      )
      order by n limit 1
    ) where p.id = row.id;
  end loop;
end $$;

create or replace function is_a_screen(said text) returns boolean
language sql immutable strict as $$
  select said in ('notifications', 'members', 'chat', 'settings', 'search', 'projects', 'more', 'admin', 'account')
$$;
