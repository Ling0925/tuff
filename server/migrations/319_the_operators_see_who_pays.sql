/*
 * Plans in the operator's admin.
 *
 * Nothing new is kept: every figure is read from what is already there —
 * accounts, workspaces and their plan, Polar's subscriptions, gifts,
 * AppSumo's keys and the security log's lines about them. What is added is
 * the funnel's cohort as a function of its own, so the new table's
 * sign-ups and the funnel's are one query and cannot disagree; the
 * workspaces left out, as one set; the two questions; and an index.
 */

/*
 * The funnel's sign-ups between two moments,
 * stage 1: an account made then, not by accepting an invitation, not at a
 * left-out address, not an operator's, not deleted.
 *
 * A plain SQL function, not a definer and with no settings of its own, so
 * the planner writes it into the query that asks and reads it by the index
 * on `app_user (created_at)` as it read the funnel's own CTE. Granted to
 * nobody: it is only ever called from the operators' definers below, which
 * run it as the tables' owner.
 */
create or replace function funnel_signed_up(p_from timestamptz, p_to timestamptz)
returns table (actor_id uuid, created_at timestamptz, email_verified_at timestamptz, seen_at timestamptz)
language sql stable as $$
  select u.actor_id, u.created_at, u.email_verified_at, a.seen_at
  from app_user u join actor a on a.id = u.actor_id
  where u.created_at >= p_from
    and u.created_at <= p_to
    and a.deleted_at is null
    and not funnel_left_out(u.email::text)
    and not exists (select 1 from operator o where o.actor_id = u.actor_id)
    /* Made by accepting an invitation: the membership came in the same
       transaction as the account, with somebody who asked. */
    and not exists (
      select 1 from membership m
      where m.actor_id = u.actor_id and m.invited_by is not null
        and m.created_at = u.created_at
    )
$$;
revoke all on function funnel_signed_up(timestamptz, timestamptz) from public;

/*
 * The first moment of the oldest of `p_count` weeks or months (up to
 * fifty-two) ending with the one `p_now` is in, in UTC. A function rather
 * than `(select min(…) from periods)` where it is used: the planner writes
 * a set-returning function into the query only when its arguments hold no
 * subquery, and `funnel_signed_up` read as a function of its own was most
 * of the funnel's time — 80 ms of 125 on the dev database.
 */
create or replace function period_since(p_unit text, p_count int, p_now timestamptz) returns timestamptz
language sql immutable parallel safe as $$
  select case when p_unit = 'month'
    then (date_trunc('month', p_now at time zone 'UTC') - make_interval(months => least(greatest(p_count, 1), 52) - 1))
    else (date_trunc('week', p_now at time zone 'UTC') - make_interval(weeks => least(greatest(p_count, 1), 52) - 1))
  end at time zone 'UTC'
$$;
revoke all on function period_since(text, int, timestamptz) from public;

/* The funnel, as migration 214 wrote it, reading its cohort from the function above. */
create or replace function operator_funnel(p_weeks int, p_now timestamptz)
returns table (
  week date, signed_up int, confirmed int, made_project int,
  brought_someone int, came_back int, due int
)
language sql stable security definer set search_path = public, pg_temp set jit = off as $$
  with weeks as (
    select (date_trunc('week', p_now at time zone 'UTC')
            - make_interval(weeks => n))::date as week
    from generate_series(0, least(greatest(p_weeks, 1), 52) - 1) n
  ),
  cohort as (
    select s.actor_id, s.created_at, s.email_verified_at, s.seen_at,
           date_trunc('week', s.created_at at time zone 'UTC')::date as week
    from funnel_signed_up(period_since('week', p_weeks, p_now), p_now) s
    where is_operator()
  ),
  made as (
    select distinct e.actor_id
    from activity_event e
    join project p on p.id = e.project_id and not p.sample
    where e.actor_id in (select actor_id from cohort)
      and e.action in ('project.create', 'project.copy', 'project.import')
  ),
  invited as (
    select distinct i.created_by as actor_id
    from invite i
    where i.created_by in (select actor_id from cohort)
  ),
  theirs as (
    select mine.actor_id, mine.workspace_id
    from membership mine join cohort c on c.actor_id = mine.actor_id
    where mine.role = 'owner' or mine.created_at = c.created_at
  ),
  joined as (
    select distinct t.actor_id
    from theirs t
    cross join lateral (
      select 1 from membership other
      join app_user them on them.actor_id = other.actor_id
      where other.workspace_id = t.workspace_id and other.actor_id <> t.actor_id
        and other.deleted_at is null
      limit 1
    ) x
  ),
  marked as (
    select c.week,
           c.email_verified_at is not null as confirmed,
           made.actor_id is not null as made_project,
           (invited.actor_id is not null or joined.actor_id is not null) as brought_someone,
           c.created_at <= p_now - interval '7 days' as due,
           c.seen_at >= c.created_at + interval '7 days' as came_back
    from cohort c
    left join made on made.actor_id = c.actor_id
    left join invited on invited.actor_id = c.actor_id
    left join joined on joined.actor_id = c.actor_id
  )
  select w.week,
         count(m.week)::int,
         count(*) filter (where m.confirmed)::int,
         count(*) filter (where m.made_project)::int,
         count(*) filter (where m.brought_someone)::int,
         count(*) filter (where m.due and m.came_back)::int,
         count(*) filter (where m.due)::int
  from weeks w left join marked m on m.week = w.week
  where is_operator()
  group by w.week
  order by w.week desc
$$;

/*
 * The workspaces the plans leave out: a board by link, or one somebody
 * owns at a test, seed or our own address, or an operator — Usage's rule
 * (`usage_left_out`), as a set. An owner taken out of a live workspace no
 * longer says anything about it; in the bin every membership is marked
 * deleted with the workspace, so there the owner it went with still
 * counts. Granted to nobody, as above.
 */
create or replace function plans_left_out()
returns table (workspace_id uuid)
language sql stable as $$
  select w.id from workspace w where w.scratch
  union
  select m.workspace_id
  from membership m join app_user u on u.actor_id = m.actor_id
  where m.role = 'owner'
    and (m.deleted_at is null
         or exists (select 1 from workspace w where w.id = m.workspace_id and w.deleted_at is not null))
    and (funnel_left_out(u.email::text)
         or exists (select 1 from operator o where o.actor_id = m.actor_id))
$$;
revoke all on function plans_left_out() from public;

/*
 * The security log's AppSumo lines by when — the sign-ins beside them are
 * never read. Built inside this file's transaction, so it holds writes to
 * `security_event`, which is never cleared, while it is made: on a table
 * much larger than today's, build it by hand first with `create index
 * concurrently` and the same name and definition; `if not exists` then
 * takes it as it is, as 187, 285 and 314 do.
 */
create index if not exists security_event_appsumo on security_event (at)
  where kind in ('appsumo.apply', 'appsumo.end');

/*
 * Where the plans stand at `p_now`: accounts, workspaces, each plan, and
 * of them the paying — a live Polar subscription, the newest as
 * `billing_apply` follows it, `active` and not revoked here — with what is
 * on a plan without paying for it: yearly ones among the paying, trials,
 * failing payments, gifts, and AppSumo's Team for life.
 *
 * `p_now` bounds only which accounts and workspaces are counted — those
 * made by then — so a test can read a past of its own making, where
 * nothing else was made. Everything about them is as it stands now,
 * whatever `p_now` says: the plan, the subscription and its status, the
 * gift and the key are their state today, not at `p_now`, because none of
 * them keeps its history. The endpoint passes now(), where the two are
 * the same. One row for an operator, none for anybody else.
 */
create or replace function operator_plans_now(p_now timestamptz)
returns table (
  accounts int, workspaces int,
  solo int, team int, company int, unlimited int,
  paying_team int, paying_company int, paying_unlimited int,
  yearly int, trialing int, past_due int, gifted int, lifetime int
)
language sql stable security definer set search_path = public, pg_temp set jit = off as $$
  with people as (
    select count(*)::int as n
    from app_user u join actor a on a.id = u.actor_id
    where is_operator()
      and u.created_at <= p_now
      and a.deleted_at is null
      and not funnel_left_out(u.email::text)
      and not exists (select 1 from operator o where o.actor_id = u.actor_id)
  ),
  live as (
    select distinct on (b.workspace_id) b.workspace_id, b.plan, b.period, b.status, b.revoked_at
    from billing_subscription b
    where billing_live(b.status)
    order by b.workspace_id, b.modified_at desc
  ),
  ws as (
    select w.plan, l.plan as paid, l.period, l.status,
           l.status = 'active' and l.revoked_at is null as paying,
           exists (select 1 from plan_gift g where g.workspace_id = w.id) as gifted,
           exists (select 1 from appsumo_licence k where k.workspace_id = w.id and k.status = 'active') as keyed
    from workspace w
    left join live l on l.workspace_id = w.id
    where is_operator()
      and w.deleted_at is null
      and w.created_at <= p_now
      and not exists (select 1 from plans_left_out() o where o.workspace_id = w.id)
  )
  select (select n from people),
         count(*)::int,
         count(*) filter (where plan = 'solo')::int,
         count(*) filter (where plan = 'team')::int,
         count(*) filter (where plan = 'company')::int,
         count(*) filter (where plan = 'unlimited')::int,
         count(*) filter (where paying and paid = 'team')::int,
         count(*) filter (where paying and paid = 'company')::int,
         count(*) filter (where paying and paid = 'unlimited')::int,
         count(*) filter (where paying and period = 'year')::int,
         count(*) filter (where status = 'trialing')::int,
         count(*) filter (where status = 'past_due')::int,
         count(*) filter (where gifted)::int,
         /* The key's Team: no live Polar plan and no gift over it. */
         count(*) filter (where keyed and status is null and not gifted)::int
  from ws
  /* Asked again here, so anybody else gets no row at all, not one of zeros. */
  having is_operator()
$$;
grant execute on function operator_plans_now(timestamptz) to tracker_app;

/*
 * The last `p_count` weeks or months (up to fifty-two) ending with the one
 * `p_now` is in, newest first, in UTC — ISO weeks by their Monday, calendar
 * months by their first — a row for each whether anything happened or not:
 * the funnel's sign-ups, new workspaces, subscriptions that started by the
 * plan they are on now, AppSumo codes applied, and plans that ended.
 *
 * Subscriptions and AppSumo's lines count a workspace in the bin too: a
 * plan that ended with its workspace is churn. One erased for good took
 * its rows with it.
 */
create or replace function operator_plans_periods(p_unit text, p_count int, p_now timestamptz)
returns table (
  start date, signed_up int, workspaces int,
  paid_team int, paid_company int, paid_unlimited int, appsumo int, left_paid int
)
language sql stable security definer set search_path = public, pg_temp set jit = off as $$
  with unit as (select case when p_unit = 'month' then 'month' else 'week' end as u),
  periods as (
    select (date_trunc((select u from unit), p_now at time zone 'UTC')
            - ((n || ' ' || (select u from unit))::interval))::date as start
    from generate_series(0, least(greatest(p_count, 1), 52) - 1) n
  ),
  /* Read once: asked in each column below, it was read three times. */
  out_ws as materialized (select o.workspace_id from plans_left_out() o),
  signed as (
    select date_trunc((select u from unit), s.created_at at time zone 'UTC')::date as start, count(*)::int as n
    from funnel_signed_up(period_since(p_unit, p_count, p_now), p_now) s
    where is_operator()
    group by 1
  ),
  made as (
    select date_trunc((select u from unit), w.created_at at time zone 'UTC')::date as start, count(*)::int as n
    from workspace w
    where is_operator()
      and w.created_at >= period_since(p_unit, p_count, p_now) and w.created_at <= p_now
      and w.deleted_at is null
      and not exists (select 1 from out_ws o where o.workspace_id = w.id)
    group by 1
  ),
  /* Every subscription that went live, with when it was over, if it is. */
  subs as (
    select b.plan, b.created_at,
           case when b.revoked_at is not null or not billing_live(b.status)
                then coalesce(b.ended_at, b.revoked_at, b.modified_at) end as over_at
    from billing_subscription b
    where is_operator()
      and b.status not in ('incomplete', 'incomplete_expired')
      and not exists (select 1 from out_ws o where o.workspace_id = b.workspace_id)
  ),
  paid as (
    select date_trunc((select u from unit), s.created_at at time zone 'UTC')::date as start,
           count(*) filter (where s.plan = 'team')::int as team,
           count(*) filter (where s.plan = 'company')::int as company,
           count(*) filter (where s.plan = 'unlimited')::int as unlimited
    from subs s
    where s.created_at >= period_since(p_unit, p_count, p_now) and s.created_at <= p_now
    group by 1
  ),
  over as (
    select date_trunc((select u from unit), s.over_at at time zone 'UTC')::date as start, count(*)::int as n
    from subs s
    where s.over_at >= period_since(p_unit, p_count, p_now) and s.over_at <= p_now
    group by 1
  ),
  /*
   * A key's end once per workspace, at the first line that says it: an
   * upgrade whose new key went elsewhere ends the old one here and leaves
   * it naming the workspace (`appsumo_hear`, migration 199), so its own
   * `deactivate`, when it comes, writes a second line for the same key.
   * The first is found over all time, then kept only if it falls in the
   * periods — a repeat inside them of an end before them is not an end.
   */
  ended as (
    select x.at
    from (
      select distinct on (e.workspace_id, e.meta->>'key') e.workspace_id, e.at
      from security_event e
      where is_operator()
        and e.kind = 'appsumo.end'
        and e.workspace_id is not null
        and e.at <= p_now
      order by e.workspace_id, e.meta->>'key', e.at
    ) x
    where x.at >= period_since(p_unit, p_count, p_now)
      and not exists (select 1 from out_ws o where o.workspace_id = x.workspace_id)
  ),
  sumo as (
    select date_trunc((select u from unit), l.at at time zone 'UTC')::date as start,
           count(*) filter (where l.applied)::int as applied,
           count(*) filter (where not l.applied)::int as ended
    from (
      select e.at, true as applied
      from security_event e
      where is_operator()
        and e.kind = 'appsumo.apply'
        and e.at >= period_since(p_unit, p_count, p_now) and e.at <= p_now
        and e.workspace_id is not null
        and not exists (select 1 from out_ws o where o.workspace_id = e.workspace_id)
      union all
      select ended.at, false from ended
    ) l
    group by 1
  )
  select p.start,
         coalesce(s.n, 0), coalesce(m.n, 0),
         coalesce(pd.team, 0), coalesce(pd.company, 0), coalesce(pd.unlimited, 0),
         coalesce(su.applied, 0),
         coalesce(o.n, 0) + coalesce(su.ended, 0)
  from periods p
  left join signed s on s.start = p.start
  left join made m on m.start = p.start
  left join paid pd on pd.start = p.start
  left join over o on o.start = p.start
  left join sumo su on su.start = p.start
  /* Asked again here, so anybody else gets no periods at all, not empty ones. */
  where is_operator()
  order by p.start desc
$$;
grant execute on function operator_plans_periods(text, int, timestamptz) to tracker_app;
