/*
 * The people who run the product, and the plans they give.
 */

/* ------------------------------------------------------------ operators */

/*
 * Not a role: a workspace gives roles, and the owner of every workspace
 * holds the top one. An operator is somebody the deployment trusts, so the
 * application role can neither read nor write this table — RLS on and no
 * policy, and nothing granted. Migrations and the seed, as the table owner,
 * are the only ways in; `OPERATORS` in the environment is synced by the
 * migration runner at every start.
 */
create table operator (
  actor_id uuid primary key references actor(id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table operator enable row level security;
revoke all on operator from tracker_app;

/* Whether whoever is asking is one. Every function below asks this itself,
   so a handler that forgot to ask still gets nothing. */
create function is_operator() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from operator where actor_id = current_actor())
$$;
grant execute on function is_operator() to tracker_app;

/* Who is asking, now with whether they are an operator — `can` answers
   `operator` from it, as it answers everything else. */
drop function auth_context(uuid, uuid);
create function auth_context(p_actor uuid, p_workspace uuid)
returns table (role text, settings jsonb, rights json,
               may_create_projects boolean, may_create_channels boolean,
               operator boolean)
language sql stable security definer set search_path = public as $$
  select m.role::text, w.settings,
         coalesce((
           select json_agg(json_build_object('p', pm.project_id, 'r', pm.rights))
           from project_member pm
           where pm.actor_id = m.actor_id and pm.workspace_id = m.workspace_id
             and pm.deleted_at is null
         ), '[]'),
         m.may_create_projects, m.may_create_channels,
         exists (select 1 from operator o where o.actor_id = p_actor)
  from membership m join workspace w on w.id = m.workspace_id
  where m.actor_id = p_actor and m.workspace_id = p_workspace
    and m.deleted_at is null and m.joined_at is not null
$$;
grant execute on function auth_context(uuid, uuid) to tracker_app;

/* ----------------------------------------------------------------- gifts */

/*
 * A plan nobody paid for, and what the workspace was on before it.
 *
 * Its own table rather than columns on `workspace`: every member can read
 * their workspace's row, and what an operator wrote down about a gift is
 * not theirs. Members read only the plan and the date, through the policy;
 * nobody writes but the functions below.
 */
create table plan_gift (
  workspace_id uuid primary key references workspace(id),
  plan text not null check (plan in ('solo', 'team', 'company', 'unlimited')),
  before text not null check (before in ('solo', 'team', 'company', 'unlimited')),
  until timestamptz,
  given_by uuid references actor(id),
  given_at timestamptz not null default now()
);
alter table plan_gift enable row level security;
create policy plan_gift_read on plan_gift for select using (is_member(workspace_id));
grant select on plan_gift to tracker_app;

/* Give one, or give another in its place — which keeps what the workspace
   was on before the first, so ending it goes back there. */
create function operator_gift(p_workspace uuid, p_plan text, p_until timestamptz)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not is_operator() then return false; end if;
  if not exists (select 1 from workspace where id = p_workspace and deleted_at is null) then
    return false;
  end if;
  insert into plan_gift (workspace_id, plan, before, until, given_by)
  select p_workspace, p_plan, w.plan, p_until, current_actor()
  from workspace w where w.id = p_workspace
  on conflict (workspace_id) do update
    set plan = excluded.plan, until = excluded.until,
        given_by = excluded.given_by, given_at = now();
  update workspace set plan = p_plan where id = p_workspace;
  return true;
end $$;
grant execute on function operator_gift(uuid, text, timestamptz) to tracker_app;

/* Ended by an operator: back to what it was on. */
create function operator_end_gift(p_workspace uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare was text;
begin
  if not is_operator() then return false; end if;
  delete from plan_gift where workspace_id = p_workspace returning before into was;
  if was is null then return false; end if;
  update workspace set plan = was where id = p_workspace;
  return true;
end $$;
grant execute on function operator_end_gift(uuid) to tracker_app;

/* Ended by its date, from the worker's hourly pass. Asks nobody: all it
   can do is what each gift already said would happen. */
create function end_gifts() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  with gone as (
    delete from plan_gift where until is not null and until <= now()
    returning workspace_id, before
  )
  update workspace w set plan = gone.before from gone where w.id = gone.workspace_id;
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function end_gifts() to tracker_app;

/* ---------------------------------------------------------- what it sees */

/* Every workspace, newest first, a page at a time — or the one named, for
   the head of its own page. */
create function operator_workspaces(p_q text, p_before_at timestamptz, p_before_id uuid, p_limit int,
                                     p_only uuid default null)
returns table (
  id uuid, name text, slug text, plan text, created_at timestamptz,
  mark_icon text, mark_tint smallint, icon_key text,
  owner_id uuid, owner_name text, owner_email text,
  people int, projects int, bytes bigint,
  gift_until timestamptz, gifted boolean
)
language sql stable security definer set search_path = public as $$
  select w.id, w.name, w.slug::text, w.plan, w.created_at,
         w.mark_icon, w.mark_tint, w.icon_key,
         o.actor_id, a.name, u.email::text,
         workspace_people(w.id),
         (select count(*)::int from project p where p.workspace_id = w.id and p.deleted_at is null),
         workspace_storage_bytes(w.id),
         g.until, g.workspace_id is not null
  from workspace w
  left join lateral (
    select m.actor_id from membership m
    where m.workspace_id = w.id and m.role = 'owner' and m.deleted_at is null
    order by m.created_at limit 1
  ) o on true
  left join actor a on a.id = o.actor_id
  left join app_user u on u.actor_id = o.actor_id
  left join plan_gift g on g.workspace_id = w.id
  where is_operator() and w.deleted_at is null
    and (p_only is null or w.id = p_only)
    and (p_q is null
         or w.name ilike '%' || p_q || '%' or w.slug::text ilike '%' || p_q || '%'
         or a.name ilike '%' || p_q || '%' or u.email::text ilike '%' || p_q || '%')
    and (p_before_at is null or (w.created_at, w.id) < (p_before_at, p_before_id))
  order by w.created_at desc, w.id desc
  limit least(greatest(p_limit, 1), 100)
$$;
grant execute on function operator_workspaces(text, timestamptz, uuid, int, uuid) to tracker_app;

/* One workspace whole: its people and its projects. */
create function operator_workspace(p_id uuid) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'people', coalesce((
      select json_agg(json_build_object(
        'actor_id', m.actor_id, 'name', a.name, 'email', u.email::text,
        'role', m.role::text, 'joined_at', m.joined_at, 'seen_at', a.seen_at,
        'avatar_key', a.avatar_key
      ) order by m.role = 'owner' desc, a.name)
      from membership m join actor a on a.id = m.actor_id
      left join app_user u on u.actor_id = m.actor_id
      where m.workspace_id = p_id and m.deleted_at is null
    ), '[]'),
    'projects', coalesce((
      select json_agg(json_build_object(
        'id', p.id, 'name', p.name, 'slug', p.slug::text,
        'created_at', p.created_at, 'archived_at', p.archived_at,
        'people', (select count(*) from project_member pm
                   where pm.project_id = p.id and pm.deleted_at is null),
        'tasks', (select count(*) from task t
                  where t.project_id = p.id and t.deleted_at is null)
      ) order by p.created_at desc)
      from project p where p.workspace_id = p_id and p.deleted_at is null
    ), '[]')
  )
  where is_operator()
    and exists (select 1 from workspace where id = p_id and deleted_at is null)
$$;
grant execute on function operator_workspace(uuid) to tracker_app;

/* Everybody with an account, newest first, with where they are. */
create function operator_people(p_q text, p_before_at timestamptz, p_before_id uuid, p_limit int)
returns table (
  actor_id uuid, name text, email text, created_at timestamptz,
  seen_at timestamptz, avatar_key text, second_factor boolean, workspaces json
)
language sql stable security definer set search_path = public as $$
  select u.actor_id, a.name, u.email::text, u.created_at,
         a.seen_at, a.avatar_key, u.totp_enabled,
         coalesce((
           select json_agg(json_build_object(
             'id', w.id, 'name', w.name, 'slug', w.slug::text,
             'role', m.role::text, 'plan', w.plan
           ) order by w.name)
           from membership m join workspace w on w.id = m.workspace_id
           where m.actor_id = u.actor_id and m.deleted_at is null and w.deleted_at is null
         ), '[]')
  from app_user u join actor a on a.id = u.actor_id
  where is_operator() and a.deleted_at is null
    and (p_q is null or a.name ilike '%' || p_q || '%' or u.email::text ilike '%' || p_q || '%')
    and (p_before_at is null or (u.created_at, u.actor_id) < (p_before_at, p_before_id))
  order by u.created_at desc, u.actor_id desc
  limit least(greatest(p_limit, 1), 100)
$$;
grant execute on function operator_people(text, timestamptz, uuid, int) to tracker_app;

/* ------------------------------------------------------------ its address */

/* `admin` stands where a project's slug would — `/:ws/admin` — so it is
   refused as one, and a project already called that steps aside. */
do $$
declare row record;
begin
  for row in select id, workspace_id from project where slug = 'admin' loop
    update project p set slug = (
      select 'admin-' || n from generate_series(2, 1000) n
      where not exists (
        select 1 from project o
        where o.workspace_id = row.workspace_id and o.slug = ('admin-' || n)::citext
      )
      order by n limit 1
    ) where p.id = row.id;
  end loop;
end $$;

create or replace function is_a_screen(said text) returns boolean
language sql immutable strict as $$
  select said in ('notifications', 'members', 'chat', 'settings', 'search', 'projects', 'more', 'admin')
$$;
