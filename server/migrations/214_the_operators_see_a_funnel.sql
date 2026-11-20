/*
 * The funnel by week of sign-up.
 *
 * Nothing new is kept about anybody: every stage is read from what is
 * already there — the account, the feed's project lines, invitations,
 * memberships and `actor.seen_at`. What is added is the list of who is
 * left out, the one query, and three indexes so that query reads only the
 * rows it is about.
 */

/*
 * Addresses nobody signs up from for real: the seed's, the tests' and the
 * load table's (`example.com` and the names reserved by RFC 2606 and
 * 6761), our own, and AppSumo's reviewers'. One function, so the screen
 * and a hand query agree on it.
 */
create function funnel_left_out(p_email text) returns boolean
language sql immutable parallel safe as $$
  /* Matched by `like`, not a regular expression: over every account in
     twelve weeks the expression was most of the query's time. */
  select split_part(lower(p_email), '@', 2)
           in ('example.com', 'example.net', 'example.org', 'usetuff.com', 'appsumo.com')
      or split_part(lower(p_email), '@', 2)
           like any (array['%.example.com', '%.example.net', '%.example.org',
                           '%.usetuff.com', '%.appsumo.com',
                           '%.example', '%.test', '%.invalid', '%.localhost'])
$$;
grant execute on function funnel_left_out(text) to tracker_app;

/* The weeks' accounts, read by when they were made. */
create index app_user_by_created on app_user (created_at);

/* Who made an invitation — stage 4. */
create index invite_by_creator on invite (created_by);

/* The feed's project lines by who made them — stage 3. Partial: a
   person's thousands of task edits are never read to find one project. */
create index activity_made_a_project on activity_event (actor_id)
  where action in ('project.create', 'project.copy', 'project.import');

/*
 * Twelve weeks (or `p_weeks`, up to fifty-two) ending with the one `p_now`
 * is in, ISO weeks in UTC, newest first; a row for every week, sign-ups or
 * none. `due` is how many of the week's accounts are seven days old by
 * `p_now`, which is what stage 5 is measured against.
 *
 * `p_now` is the clock: the endpoint passes now(), and a test can read a
 * week of its own making far in the past, where nothing else is.
 *
 * No JIT: compiling this query cost half a second, every time, for a
 * query that runs in a few milliseconds.
 */
create function operator_funnel(p_weeks int, p_now timestamptz)
returns table (
  week date, signed_up int, confirmed int, made_project int,
  brought_someone int, came_back int, due int
)
language sql stable security definer set search_path = public set jit = off as $$
  with weeks as (
    select (date_trunc('week', p_now at time zone 'UTC')
            - make_interval(weeks => n))::date as week
    from generate_series(0, least(greatest(p_weeks, 1), 52) - 1) n
  ),
  cohort as (
    select u.actor_id, u.created_at, u.email_verified_at, a.seen_at,
           date_trunc('week', u.created_at at time zone 'UTC')::date as week
    from app_user u join actor a on a.id = u.actor_id
    where is_operator()
      and u.created_at >= ((select min(w.week) from weeks w)::timestamp at time zone 'UTC')
      and u.created_at <= p_now
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
  ),
  /*
   * Each step as a set of who took it, not a question asked once per
   * account: asked per account, "a second person in a workspace of theirs"
   * read every membership there is for each of them — ten seconds on the
   * load table's thousand.
   */
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
  /* The workspaces they made (the membership came with the account) or own. */
  theirs as (
    select mine.actor_id, mine.workspace_id
    from membership mine join cohort c on c.actor_id = mine.actor_id
    where mine.role = 'owner' or mine.created_at = c.created_at
  ),
  /* Somebody else with an account in one of them now — looked up per
     workspace, a row at most, so a workspace of a thousand reads one. */
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
  /* Asked again here, so anybody else gets no weeks at all, not empty ones. */
  where is_operator()
  group by w.week
  order by w.week desc
$$;
grant execute on function operator_funnel(int, timestamptz) to tracker_app;
