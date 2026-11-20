/*
 * An address a person can read.
 *
 * A project had only the key the database uses, so its address was
 * `/p/01a0e859-dffb-72f9-b662-4f5dbabf8f02/tasks`: stable, sendable, and
 * unreadable. It gets a slug of its own, and the things inside it get a
 * number.
 */

/* ------------------------------------------------------------ the slug */

/*
 * Lower case, runs of anything else to a single dash, trimmed.
 *
 * Immutable so an index could be built on it later, and `strict` so a null
 * name is a null slug rather than an empty one.
 */
create function slugify(said text) returns text
language sql immutable strict as $$
  select nullif(trim(both '-' from regexp_replace(lower(said), '[^a-z0-9]+', '-', 'g')), '')
$$;

/*
 * The six names the app uses at the same level as a project.
 *
 * Here and not only in the endpoint, because the seed, the import and a
 * template copy all write projects directly — a rule written in a controller
 * is a rule the next way in does not have. `web/src/data/route.ts` holds the
 * same six for the parser, and neither list is allowed to grow alone.
 */
create function is_a_screen(said text) returns boolean
language sql immutable strict as $$
  select said in ('notifications', 'members', 'chat', 'settings', 'search', 'projects')
$$;

alter table project add column slug citext;

/*
 * One per name per workspace, and the second one gets a number.
 *
 * Filled only when nothing supplies one, so a copy of a project or an import
 * can carry a slug it already had. The loop is why this is not a default
 * expression: what is free depends on what is already there.
 */
create function project_slug_fills_itself() returns trigger
language plpgsql as $$
declare
  base text;
  tried text;
  n int := 1;
begin
  if new.slug is not null then
    return new;
  end if;
  base := coalesce(slugify(new.name), 'project');
  tried := base;
  while is_a_screen(tried) or exists (
    select 1 from project
    where workspace_id = new.workspace_id and slug = tried and id <> new.id
  ) loop
    n := n + 1;
    tried := base || '-' || n;
  end loop;
  new.slug := tried;
  return new;
end $$;

create trigger project_slug_fills_itself
  before insert on project
  for each row execute function project_slug_fills_itself();

/* What is already here, oldest first, so the first "Website" keeps the name
   it would have had. */
do $$
declare row record;
begin
  for row in select id, workspace_id, name from project order by created_at, id loop
    update project set slug = null where id = row.id;
    update project p set slug = (
      select tried from (
        select case when n = 1 then base else base || '-' || n end as tried, n
        from (select coalesce(slugify(row.name), 'project') as base) b,
             generate_series(1, 50) as n
      ) c
      where not is_a_screen(c.tried)
        and not exists (
          select 1 from project o
          where o.workspace_id = row.workspace_id and o.slug = c.tried and o.id <> row.id
        )
      order by c.n limit 1
    ) where p.id = row.id;
  end loop;
end $$;

alter table project alter column slug set not null;
alter table project add constraint project_slug_is_not_a_screen check (not is_a_screen(slug));
create unique index project_slug_in_workspace on project (workspace_id, slug);

/* ---------------------------------------------------------- the number */

/*
 * One counter per project, shared by everything addressable in it.
 *
 * Not one per kind: two objects in a project never share a number, so "41"
 * names one thing whatever kind it is. A counter and not `max(number) + 1`,
 * because that hands the same number out twice as soon as something is
 * thrown away — and a number that comes back is an old link opening a new
 * object.
 */
alter table project add column seq int not null default 0;

alter table task add column number int;
alter table post add column number int;
alter table file add column number int;

create function number_in_project() returns trigger
language plpgsql as $$
begin
  if new.number is null then
    update project set seq = seq + 1 where id = new.project_id returning seq into new.number;
  end if;
  return new;
end $$;

create trigger task_number_in_project before insert on task
  for each row execute function number_in_project();
create trigger post_number_in_project before insert on post
  for each row execute function number_in_project();
create trigger file_number_in_project before insert on file
  for each row execute function number_in_project();

/* Everything already here, in the order it was made, so the numbers read as
   the history they are. */
do $$
declare row record;
begin
  for row in
    select id, project_id, 'task' as kind, created_at from task
    union all select id, project_id, 'post', created_at from post
    union all select id, project_id, 'file', created_at from file
    order by project_id, created_at, id
  loop
    update project set seq = seq + 1 where id = row.project_id;
    if row.kind = 'task' then
      update task set number = (select seq from project where id = row.project_id) where id = row.id;
    elsif row.kind = 'post' then
      update post set number = (select seq from project where id = row.project_id) where id = row.id;
    else
      update file set number = (select seq from project where id = row.project_id) where id = row.id;
    end if;
  end loop;
end $$;

alter table task alter column number set not null;
alter table post alter column number set not null;
alter table file alter column number set not null;

/* The address looks a thing up by it, so it is indexed the way the address
   is read: this project, this number. */
create unique index task_number_in_project on task (project_id, number);
create unique index post_number_in_project on post (project_id, number);
create unique index file_number_in_project on file (project_id, number);
