/*
 * Which features each workspace uses, and how much.
 *
 * A count per workspace, per feature, per day (UTC), and how many different
 * people used it that day. Nothing else: no content, no object's id, no
 * address, no browser, and never who — the server counts distinct people in
 * memory and writes only the number. Written by the hosted service alone;
 * a server of one's own never writes a
 * row, and the table is empty there.
 *
 * Nobody but the operators reads it, and only through the functions below:
 * row-level security on with no policy, nothing granted to the application
 * role. It writes through `usage_add`, which takes numbers and names only.
 */
create table feature_use (
  workspace_id uuid not null references workspace(id) on delete cascade,
  feature text not null check (feature ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$' and length(feature) <= 64),
  day date not null,
  uses integer not null default 0 check (uses >= 0),
  people integer not null default 0 check (people >= 0),
  /* Rebuilt by this migration from rows already there, not counted as it
     happened — the screen says which. */
  backfilled boolean not null default false,
  primary key (workspace_id, feature, day)
);
alter table feature_use enable row level security;
revoke all on feature_use from public, tracker_app;

/* The screen's first table reads a feature's days across every workspace. */
create index feature_use_by_feature on feature_use (feature, day) include (workspace_id, uses, people);
/* And the clear-out, the oldest days. */
create index feature_use_by_day on feature_use (day);

/*
 * What the server counted since it last wrote: `[{ w, f, d, n, p }]` —
 * workspace, feature, day, uses since, people that day so far. Uses add;
 * people is the larger of what is there and what is said, because the
 * server says its whole day's count each time and a second process, or one
 * started again at noon, knows only its own share. That undercounts and
 * never invents anybody.
 *
 * A workspace gone since is skipped rather than failing the batch.
 */
create function usage_add(p_rows jsonb) returns integer
language sql volatile security definer set search_path = public as $$
  with said as (
    select r.w, r.f, r.d, greatest(r.n, 0) as n, greatest(r.p, 0) as p
    from jsonb_to_recordset(case when jsonb_typeof(p_rows) = 'array' then p_rows else '[]'::jsonb end)
      as r(w uuid, f text, d date, n int, p int)
    where r.w is not null and r.f is not null and r.d is not null
      and r.d between (now() at time zone 'UTC')::date - 2 and (now() at time zone 'UTC')::date + 1
      and r.f ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$' and length(r.f) <= 64
    limit 20000
  ),
  put as (
    insert into feature_use as u (workspace_id, feature, day, uses, people)
    select s.w, s.f, s.d, s.n, s.p from said s
    where exists (select 1 from workspace w where w.id = s.w)
    on conflict (workspace_id, feature, day) do update
      set uses = u.uses + excluded.uses, people = greatest(u.people, excluded.people)
    returning 1
  )
  select count(*)::int from put
$$;
revoke execute on function usage_add(jsonb) from public;
grant execute on function usage_add(jsonb) to tracker_app;

/* Days older than `p_days`, gone — the worker's, hourly. */
create function usage_clear(p_days int) returns integer
language sql volatile security definer set search_path = public as $$
  with gone as (
    delete from feature_use where day < (now() at time zone 'UTC')::date - greatest(p_days, 31) returning 1
  )
  select count(*)::int from gone
$$;
revoke execute on function usage_clear(int) from public, tracker_app;
grant execute on function usage_clear(int) to tracker_worker;

/*
 * The workspaces the screen leaves out, as the funnel leaves out accounts:
 * an owner at a test, seed or our own address, or
 * an operator; boards by link; deleted ones.
 */
create function usage_left_out(p_ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select w.scratch or w.deleted_at is not null or exists (
      select 1 from membership m join app_user u on u.actor_id = m.actor_id
      where m.workspace_id = w.id and m.role = 'owner' and m.deleted_at is null
        and (funnel_left_out(u.email::text)
             or exists (select 1 from operator o where o.actor_id = m.actor_id)))
    from workspace w where w.id = p_ws), true)
$$;
revoke execute on function usage_left_out(uuid) from public;
grant execute on function usage_left_out(uuid) to tracker_app;

/*
 * Every feature used in the last eight weeks, across the workspaces not left
 * out: in the last 7 and 30 days the workspaces that used it, its uses, and
 * people — the most on any one day in each workspace, summed, which is as
 * many as certainly used it — and its uses in each of the last eight ISO
 * weeks, this one first. `p_now` is the clock, so a test can read days of
 * its own making.
 */
create function operator_usage(p_now timestamptz)
returns table (
  feature text, workspaces_7 int, uses_7 int, people_7 int,
  workspaces_30 int, uses_30 int, people_30 int,
  weeks int[], last_day date, backfilled boolean
)
language sql stable security definer set search_path = public set jit = off as $$
  with today as (select (p_now at time zone 'UTC')::date as d),
  monday as (select date_trunc('week', (select d from today)::timestamp)::date as d),
  rows as (
    select u.* from feature_use u
    where is_operator()
      and u.day > (select d from monday) - 56 and u.day <= (select d from today)
  ),
  /* As a set, not `usage_left_out` asked once a workspace: thousands of
     calls to a definer function were most of a second. */
  kept as (
    select x.w from (select distinct workspace_id as w from rows) x
    join workspace ws on ws.id = x.w and not ws.scratch and ws.deleted_at is null
    where not exists (
      select 1 from membership m join app_user u on u.actor_id = m.actor_id
      where m.workspace_id = x.w and m.role = 'owner' and m.deleted_at is null
        and (funnel_left_out(u.email::text)
             or exists (select 1 from operator o where o.actor_id = m.actor_id)))
  ),
  per as (
    select r.feature, r.workspace_id,
           sum(r.uses) filter (where r.day > (select d from today) - 7) as uses_7,
           max(r.people) filter (where r.day > (select d from today) - 7) as people_7,
           sum(r.uses) filter (where r.day > (select d from today) - 30) as uses_30,
           max(r.people) filter (where r.day > (select d from today) - 30) as people_30,
           max(r.day) as last_day,
           bool_or(r.backfilled) as backfilled
    from rows r join kept k on k.w = r.workspace_id
    group by r.feature, r.workspace_id
  ),
  weekly as (
    select r.feature, ((select d from monday) - date_trunc('week', r.day::timestamp)::date) / 7 as ago, sum(r.uses)::int as n
    from rows r join kept k on k.w = r.workspace_id
    group by 1, 2
  )
  select p.feature,
         (count(*) filter (where p.uses_7 > 0))::int,
         coalesce(sum(p.uses_7), 0)::int,
         coalesce(sum(p.people_7), 0)::int,
         (count(*) filter (where p.uses_30 > 0))::int,
         coalesce(sum(p.uses_30), 0)::int,
         coalesce(sum(p.people_30), 0)::int,
         (select array_agg(coalesce((select w.n from weekly w where w.feature = p.feature and w.ago = g), 0) order by g)
          from generate_series(0, 7) g),
         max(p.last_day),
         bool_or(p.backfilled)
  from per p
  where is_operator()
  group by p.feature
$$;
revoke execute on function operator_usage(timestamptz) from public;
grant execute on function operator_usage(timestamptz) to tracker_app;

/* One feature's workspaces, the most uses in thirty days first. */
create function operator_usage_feature(p_feature text, p_now timestamptz, p_limit int)
returns table (
  id uuid, name text, slug text, plan text,
  uses_7 int, uses_30 int, people_30 int, last_day date, backfilled boolean
)
language sql stable security definer set search_path = public set jit = off as $$
  with today as (select (p_now at time zone 'UTC')::date as d),
  per as (
    select u.workspace_id,
           sum(u.uses) filter (where u.day > (select d from today) - 7) as uses_7,
           sum(u.uses) filter (where u.day > (select d from today) - 30) as uses_30,
           max(u.people) filter (where u.day > (select d from today) - 30) as people_30,
           max(u.day) as last_day,
           bool_or(u.backfilled) as backfilled
    from feature_use u
    where is_operator() and u.feature = p_feature
      and u.day > (select d from today) - 400 and u.day <= (select d from today)
    group by u.workspace_id
  )
  select w.id, w.name, w.slug::text, w.plan,
         coalesce(p.uses_7, 0)::int, coalesce(p.uses_30, 0)::int, coalesce(p.people_30, 0)::int,
         p.last_day, p.backfilled
  from per p join workspace w on w.id = p.workspace_id and not w.scratch and w.deleted_at is null
  where is_operator()
    and not exists (
      select 1 from membership m join app_user u on u.actor_id = m.actor_id
      where m.workspace_id = w.id and m.role = 'owner' and m.deleted_at is null
        and (funnel_left_out(u.email::text)
             or exists (select 1 from operator o where o.actor_id = m.actor_id)))
  order by coalesce(p.uses_30, 0) desc, p.last_day desc, w.id
  limit least(greatest(p_limit, 1), 200)
$$;
revoke execute on function operator_usage_feature(text, timestamptz, int) from public;
grant execute on function operator_usage_feature(text, timestamptz, int) to tracker_app;

/* One workspace's features, and when anything was last used there. Asked of
   a workspace the list leaves out too: an operator may open any. */
create function operator_usage_workspace(p_ws uuid, p_now timestamptz)
returns json
language sql stable security definer set search_path = public set jit = off as $$
  with today as (select (p_now at time zone 'UTC')::date as d),
  per as (
    select u.feature,
           coalesce(sum(u.uses) filter (where u.day > (select d from today) - 7), 0)::int as uses_7,
           coalesce(sum(u.uses) filter (where u.day > (select d from today) - 30), 0)::int as uses_30,
           coalesce(max(u.people) filter (where u.day > (select d from today) - 30), 0)::int as people_30,
           sum(u.uses)::int as uses_all,
           max(u.day) as last_day,
           bool_or(u.backfilled) as backfilled
    from feature_use u
    where u.workspace_id = p_ws and u.day <= (select d from today)
    group by u.feature
  )
  select json_build_object(
    'workspace', json_build_object('id', w.id, 'name', w.name, 'slug', w.slug::text, 'plan', w.plan,
                                   'left_out', usage_left_out(w.id)),
    'last_day', (select max(p.last_day) from per p),
    'features', coalesce((
      select json_agg(json_build_object('feature', p.feature, 'uses_7', p.uses_7, 'uses_30', p.uses_30,
                                        'people_30', p.people_30, 'uses_all', p.uses_all,
                                        'last_day', p.last_day, 'backfilled', p.backfilled)
                      order by p.uses_30 desc, p.last_day desc, p.feature)
      from per p), '[]'::json))
  from workspace w
  where w.id = p_ws and is_operator()
$$;
revoke execute on function operator_usage_workspace(uuid, timestamptz) from public;
grant execute on function operator_usage_workspace(uuid, timestamptz) to tracker_app;

/*
 * What can be read back honestly from rows already there, for the 400 days
 * before today, marked as backfilled: tasks made (not subtasks, not
 * imported, not in the sample), documents made and files uploaded, messages
 * said in a channel or directly (not brought from elsewhere, not a hook's),
 * comments, announcements, time logged, invitations sent, agents connected,
 * projects made, and documents edited — the feed's `file.update` line, one
 * per person per version, which is what the server counts from now on.
 * Rows deleted since are still counted: the thing was done.
 *
 * Today is left to the server, which counts from the moment it starts;
 * what was done earlier today, before this ran, is not counted at all.
 */
insert into feature_use (workspace_id, feature, day, uses, people, backfilled)
select workspace_id, feature, day, count(*)::int, count(distinct actor_id)::int, true
from (
  select t.workspace_id, 'task.create' as feature, (t.created_at at time zone 'UTC')::date as day, t.author_id as actor_id
  from task t join project p on p.id = t.project_id
  where t.parent_id is null and not p.sample
    and not exists (select 1 from import_task it where it.task_id = t.id)
  union all
  select f.workspace_id, case when f.storage_key is not null then 'file.upload' else 'doc.create' end,
         (f.created_at at time zone 'UTC')::date, f.author_id
  from file f left join project p on p.id = f.project_id
  where f.url is null and not coalesce(p.sample, false)
    and (f.storage_key is not null or f.conversation_id is null)
  union all
  select m.workspace_id, case when c.channel then 'chat.send' else 'dm.send' end,
         (m.created_at at time zone 'UTC')::date, m.author_id
  from message m join conversation c on c.id = m.conversation_id
  where m.origin not in ('import', 'github', 'system') and m.hook_id is null
  union all
  select cm.workspace_id, 'comment.create', (cm.created_at at time zone 'UTC')::date, cm.author_id
  from comment cm
  where cm.origin not in ('import', 'github', 'system')
  union all
  select po.workspace_id, 'announcement.post', (po.created_at at time zone 'UTC')::date, po.author_id
  from post po join project p on p.id = po.project_id
  where not p.sample
  union all
  select te.workspace_id, 'time.log', (te.created_at at time zone 'UTC')::date, te.actor_id
  from time_entry te
  union all
  select i.workspace_id, 'invite.send', (i.created_at at time zone 'UTC')::date, i.created_by
  from invite i
  union all
  select ag.workspace_id, 'agent.connect', (ag.created_at at time zone 'UTC')::date, ag.created_by
  from agent ag
  union all
  select e.workspace_id, case e.action when 'project.create' then 'project.create' else 'project.copy' end,
         (e.at at time zone 'UTC')::date, e.actor_id
  from activity_event e join project p on p.id = e.project_id and not p.sample
  where e.action in ('project.create', 'project.copy')
  union all
  select e.workspace_id, 'doc.edit', (e.at at time zone 'UTC')::date, e.actor_id
  from activity_event e
  where e.action = 'file.update'
) x
where day >= (now() at time zone 'UTC')::date - 400 and day < (now() at time zone 'UTC')::date
  and exists (select 1 from workspace w where w.id = x.workspace_id)
group by workspace_id, feature, day
on conflict (workspace_id, feature, day) do nothing;
