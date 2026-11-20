/*
 * The name a sentence uses.
 *
 * A project has a slug because an address wants one, and an address can be
 * long: nobody types `/studio/website-redesign/tasks/41`, they follow it.
 * A label in front of forty titles cannot be long, and a thing somebody
 * says out loud cannot be long either. That is what this is: `STU-41`.
 */

create function keyify(said text) returns text
language sql immutable strict as $$
  /* The first letters of it, which is what everybody's is: Design is DES
     and Worksheet is WOR. Three, because two collide across a workspace
     often enough to notice and four stops being a word you can say. */
  select upper(substring(regexp_replace(said, '[^a-zA-Z]', '', 'g') from 1 for 3))
$$;

alter table project add column key text;

/*
 * One per workspace, and the second one gets a number.
 *
 * The same shape as the slug beside it, and in a trigger for the same
 * reason: the seed, the import and a template copy all write projects
 * without going through an endpoint.
 */
create function project_key_fills_itself() returns trigger
language plpgsql as $$
declare
  base text;
  tried text;
  n int := 1;
begin
  if new.key is not null then
    return new;
  end if;
  base := coalesce(nullif(keyify(new.name), ''), 'PRJ');
  tried := base;
  while exists (
    select 1 from project
    where workspace_id = new.workspace_id and key = tried and id <> new.id
  ) loop
    n := n + 1;
    tried := base || n;
  end loop;
  new.key := tried;
  return new;
end $$;

create trigger project_key_fills_itself
  before insert on project
  for each row execute function project_key_fills_itself();

/* What is already here, oldest first, so the first Website keeps WEB. */
do $$
declare row record;
begin
  for row in select id, workspace_id, name from project order by created_at, id loop
    update project p set key = (
      select tried from (
        select case when n = 1 then base else base || n end as tried, n
        from (select coalesce(nullif(keyify(row.name), ''), 'PRJ') as base) b,
             generate_series(1, 200) as n
      ) c
      where not exists (
        select 1 from project o
        where o.workspace_id = row.workspace_id and o.key = c.tried and o.id <> row.id
      )
      order by c.n limit 1
    ) where p.id = row.id;
  end loop;
end $$;

alter table project alter column key set not null;
alter table project add constraint project_key_is_letters
  check (key ~ '^[A-Z]{1,3}[0-9]*$');
create unique index project_key_in_workspace on project (workspace_id, key);
