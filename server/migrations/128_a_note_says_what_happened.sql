/*
 * What reaches you — `docs/specs/notifications.md`.
 *
 * Four more reasons, a line saying what happened, a note that waits and
 * merges instead of piling up, a reminder of a date, and an email for what
 * was not read. The new reasons are added here and used only by name from
 * code: a value added in a transaction cannot be used in the same one.
 */
alter type notify_reason add value if not exists 'posted';
alter type notify_reason add value if not exists 'replied';
alter type notify_reason add value if not exists 'due';
alter type notify_reason add value if not exists 'added';

/* What happened, in the product's words — never what anybody wrote. */
alter table notification add column what text;
/* Told about in a digest, so the next one does not tell it again. */
alter table notification add column emailed_at timestamptz;

alter table app_user add column email_digest boolean not null default true;
alter table app_user add column last_digest_at timestamptz;

/*
 * A note written, or merged into the one still waiting.
 *
 * Merging touches a row that belongs to the person told, which the caller
 * may not update, so it is a definer function — bounded by the caller being
 * a member of the workspace and the person told being one too. A note
 * merges only while nobody has seen it: not read, not yet delivered, and
 * about the same thing for the same reason.
 */
create function notify_once(
  p_id uuid, p_workspace uuid, p_actor uuid, p_reason notify_reason, p_type object_kind,
  p_object uuid, p_what text, p_after timestamptz, p_merge boolean
) returns void
language plpgsql security definer set search_path = public as $$
declare
  waiting uuid;
begin
  if not is_member(p_workspace) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  if not exists (select 1 from membership where workspace_id = p_workspace and actor_id = p_actor
                   and deleted_at is null and joined_at is not null) then
    return;
  end if;
  if p_merge then
    select id into waiting from notification
    where actor_id = p_actor and workspace_id = p_workspace and reason = p_reason
      and object_type = p_type and object_id = p_object
      and read_at is null and delivered_at is null and deleted_at is null
    order by created_at desc limit 1
    for update;
    if waiting is not null then
      update notification
      set what = coalesce(p_what, what), deliver_after = greatest(deliver_after, p_after),
          created_at = now(), updated_at = now()
      where id = waiting;
      return;
    end if;
  end if;
  insert into notification (id, workspace_id, actor_id, reason, object_type, object_id, what, deliver_after)
  values (p_id, p_workspace, p_actor, p_reason, p_type, p_object, p_what, p_after);
end
$$;
grant execute on function notify_once to tracker_app;

/*
 * Somebody given a task follows it — and follows it again if they had
 * stopped. A subscription is its owner's row; this writes somebody else's.
 */
create function follow_for(p_workspace uuid, p_type object_kind, p_object uuid, p_actor uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_member(p_workspace) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  if not exists (select 1 from membership where workspace_id = p_workspace and actor_id = p_actor
                   and deleted_at is null and joined_at is not null) then
    return;
  end if;
  update subscription set deleted_at = null, updated_at = now()
  where object_type = p_type and object_id = p_object and actor_id = p_actor
    and deleted_at is not null
    and not exists (select 1 from subscription s2 where s2.object_type = p_type
                      and s2.object_id = p_object and s2.actor_id = p_actor and s2.deleted_at is null);
  insert into subscription (id, workspace_id, object_type, object_id, actor_id)
  select gen_random_uuid(), p_workspace, p_type, p_object, p_actor
  where not exists (select 1 from subscription s where s.object_type = p_type
                      and s.object_id = p_object and s.actor_id = p_actor and s.deleted_at is null);
end
$$;
grant execute on function follow_for to tracker_app;

/*
 * Who an announcement is for: everybody on its project, which is who may
 * read it. Asked by a member of its workspace and nobody else.
 */
create function post_audience(p_post uuid) returns table (actor_id uuid)
language sql stable security definer set search_path = public as $$
  select pm.actor_id
  from post p
  join project_member pm on pm.project_id = p.project_id and pm.deleted_at is null
  join membership m on m.workspace_id = p.workspace_id and m.actor_id = pm.actor_id
    and m.deleted_at is null and m.joined_at is not null
  where p.id = p_post and p.deleted_at is null and is_member(p.workspace_id)
$$;
grant execute on function post_audience to tracker_app;

/* Who is in a thread: whoever started it and whoever has answered in it. */
create function thread_people(p_parent uuid) returns table (actor_id uuid)
language sql stable security definer set search_path = public as $$
  select distinct x.author_id from (
    select m.author_id, m.workspace_id from message m where m.id = p_parent and m.deleted_at is null
    union all
    select r.author_id, r.workspace_id from message r where r.parent_id = p_parent and r.deleted_at is null
  ) x
  where is_member(x.workspace_id)
$$;
grant execute on function thread_people to tracker_app;

/* Everybody in a room, for `@everyone`. */
create function room_people(p_conversation uuid) returns table (actor_id uuid)
language sql stable security definer set search_path = public as $$
  select cm.actor_id from conversation_member cm
  join conversation c on c.id = cm.conversation_id
  where cm.conversation_id = p_conversation and cm.deleted_at is null and cm.joined_at is not null
    and is_member(c.workspace_id)
  union
  /* A project's channel holds everybody on the project, joined or not. */
  select pm.actor_id from conversation c
  join project_member pm on pm.project_id = c.project_id and pm.deleted_at is null
  where c.id = p_conversation and c.project_id is not null and c.channel and is_member(c.workspace_id)
$$;
grant execute on function room_people to tracker_app;

/* ------------------------------------------------------------ reminders */

create table due_reminder (
  /* In every key, as everywhere: a workspace cleared out clears these too. */
  workspace_id uuid not null references workspace(id),
  task_id uuid not null references task(id),
  actor_id uuid not null references actor(id),
  due_on date not null,
  kind text not null check (kind in ('soon', 'late')),
  at timestamptz not null default now(),
  primary key (task_id, actor_id, due_on, kind)
);
alter table due_reminder enable row level security;

/*
 * The reminders whose morning has come, claimed as they are returned so a
 * second worker does not send them twice. Nine o'clock where the person is:
 * the day before a date, and the day after one still open.
 */
create function claim_due_reminders() returns table (
  workspace_id uuid, actor_id uuid, task_id uuid, kind text, due_on date
)
language sql volatile security definer set search_path = public as $$
  with here as (
    select t.workspace_id, t.assignee_id as actor_id, t.id as task_id, t.due_on,
           (now() at time zone coalesce(u.timezone, 'UTC')) as local
    from task t
    join app_user u on u.actor_id = t.assignee_id
    join membership m on m.workspace_id = t.workspace_id and m.actor_id = t.assignee_id
      and m.deleted_at is null and m.joined_at is not null
    join project p on p.id = t.project_id and p.deleted_at is null
    where t.deleted_at is null and t.completed_at is null and t.due_on is not null
      and t.due_on between current_date - 2 and current_date + 2
  ),
  due as (
    select h.workspace_id, h.actor_id, h.task_id, h.due_on,
           case when h.local::date = h.due_on - 1 then 'soon'
                when h.local::date = h.due_on + 1 then 'late' end as kind
    from here h
    where h.local::time >= time '09:00'
  )
  insert into due_reminder (workspace_id, task_id, actor_id, due_on, kind)
  select d.workspace_id, d.task_id, d.actor_id, d.due_on, d.kind from due d where d.kind is not null
  on conflict do nothing
  returning due_reminder.workspace_id, due_reminder.actor_id, due_reminder.task_id,
            due_reminder.kind, due_reminder.due_on
$$;
grant execute on function claim_due_reminders to tracker_app;

/* --------------------------------------------------------------- digest */

/*
 * Who is owed an email: on, not mailed in the last twenty hours, in their
 * day and out of their quiet hours, with a note unread for four hours that
 * no digest has told them about yet.
 */
create function digest_due() returns table (actor_id uuid, email text, name text)
language sql stable security definer set search_path = public as $$
  select u.actor_id, u.email::text, a.name
  from app_user u join actor a on a.id = u.actor_id
  where u.email_digest and u.email_verified_at is not null and a.deleted_at is null
    and (u.last_digest_at is null or u.last_digest_at < now() - interval '20 hours')
    and (now() at time zone coalesce(u.timezone, 'UTC'))::time between time '08:00' and time '20:00'
    and not (
      u.quiet_from is not null and u.quiet_to is not null and (
        (u.quiet_from < u.quiet_to and (now() at time zone coalesce(u.timezone, 'UTC'))::time
           between u.quiet_from and u.quiet_to)
        or (u.quiet_from > u.quiet_to and ((now() at time zone coalesce(u.timezone, 'UTC'))::time >= u.quiet_from
           or (now() at time zone coalesce(u.timezone, 'UTC'))::time < u.quiet_to))))
    and exists (
      select 1 from notification n
      join membership m on m.workspace_id = n.workspace_id and m.actor_id = n.actor_id
        and m.deleted_at is null and m.joined_at is not null
      where n.actor_id = u.actor_id and n.read_at is null and n.deleted_at is null
        and n.emailed_at is null and n.deliver_after < now() - interval '4 hours'
        and n.created_at > now() - interval '7 days')
$$;
grant execute on function digest_due to tracker_app;

/*
 * What one person's digest says, and marks it told. Titles are read here
 * as nobody, so the worker checks each against what the person may still
 * see before it is mailed — the same rule a push follows.
 */
create function digest_claim(p_actor uuid) returns table (
  id uuid, workspace_id uuid, workspace_name text, workspace_slug text,
  reason notify_reason, object_type object_kind, object_id uuid, what text, created_at timestamptz
)
language sql volatile security definer set search_path = public as $$
  with picked as (
    update notification n set emailed_at = now()
    from membership m
    where n.actor_id = p_actor and m.workspace_id = n.workspace_id and m.actor_id = n.actor_id
      and m.deleted_at is null and m.joined_at is not null
      and n.read_at is null and n.deleted_at is null and n.emailed_at is null
      and n.deliver_after < now() and n.created_at > now() - interval '7 days'
    returning n.id, n.workspace_id, n.reason, n.object_type, n.object_id, n.what, n.created_at
  ), stamped as (
    update app_user set last_digest_at = now() where actor_id = p_actor
  )
  select p.id, p.workspace_id, w.name, w.slug::text, p.reason, p.object_type, p.object_id, p.what, p.created_at
  from picked p join workspace w on w.id = p.workspace_id
  order by p.created_at desc
$$;
grant execute on function digest_claim to tracker_app;

/* Off, from the link at the foot of the email — signed by the server. */
create function digest_off(p_actor uuid) returns void
language sql volatile security definer set search_path = public as $$
  update app_user set email_digest = false where actor_id = p_actor
$$;
grant execute on function digest_off to tracker_app;

/* What is due to be pushed, with its line. */
drop function due_notifications(int, uuid);
create function due_notifications(p_limit int, p_workspace uuid default null)
returns table (
  id uuid,
  workspace_id uuid,
  actor_id uuid,
  reason notify_reason,
  object_type object_kind,
  object_id uuid,
  what text
)
language sql volatile security definer set search_path = public as $$
  select n.id, n.workspace_id, n.actor_id, n.reason, n.object_type, n.object_id, n.what
  from notification n
  where n.delivered_at is null and n.deleted_at is null and n.read_at is null
    and n.deliver_after <= now()
    and (p_workspace is null or n.workspace_id = p_workspace)
    and exists (
      select 1 from push_subscription s
      where s.actor_id = n.actor_id and s.workspace_id = n.workspace_id
        and s.deleted_at is null
    )
  order by n.deliver_after
  limit p_limit
$$;
grant execute on function due_notifications to tracker_app;

/* `app_user` is granted column by column (002, 005): the switch is one. */
grant select (email_digest), update (email_digest) on app_user to tracker_app;

/* --------------------------------------------------------- many at once */

/*
 * When a note to somebody may leave, given their quiet hours — the rule
 * `notify.ts` worked out with a query per person, as one expression, so an
 * announcement to a project of a thousand is one query and not four
 * thousand. The zone is one the database knows; `notify_when` checks.
 */
create function held_until(q_from time, q_to time, z text) returns timestamptz
language sql stable set search_path = public as $$
  select case
    when q_from is null or q_to is null then now()
    when (now() at time zone z)::time between q_from and q_to
      then ((now() at time zone z)::date + q_to) at time zone z
    when q_from > q_to and ((now() at time zone z)::time >= q_from or (now() at time zone z)::time < q_to)
      then (((now() at time zone z)::date
             + case when (now() at time zone z)::time >= q_from then 1 else 0 end) + q_to) at time zone z
    else now()
  end
$$;
grant execute on function held_until to tracker_app;

/*
 * Everybody's switch and hour, in one answer. Each zone is checked once,
 * and only where somebody has quiet hours: `pg_timezone_names` is a walk of
 * every zone there is, and asked per person it was most of the time an
 * announcement to a thousand took. A zone the database does not know is
 * read as UTC.
 */
create function notify_when(p_actors uuid[]) returns table (actor_id uuid, notify_chat boolean, at timestamptz)
language sql stable security definer set search_path = public as $$
  with u as (
    select a, x.notify_chat, x.quiet_from, x.quiet_to, coalesce(x.timezone, 'UTC') as tz
    from unnest(p_actors) a left join app_user x on x.actor_id = a
  ), zones as (
    select z.tz, exists (select 1 from pg_timezone_names n where n.name = z.tz) as known
    from (select distinct tz from u where quiet_from is not null and quiet_to is not null) z
  )
  select u.a, coalesce(u.notify_chat, true),
         held_until(u.quiet_from, u.quiet_to, case when zones.known then u.tz else 'UTC' end)
  from u left join zones on zones.tz = u.tz
$$;
grant execute on function notify_when to tracker_app;

/* Notes that are never merged, written in one statement. */
create function notify_many(
  p_workspace uuid, p_ids uuid[], p_actors uuid[], p_reasons notify_reason[],
  p_type object_kind, p_object uuid, p_whats text[], p_ats timestamptz[]
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_member(p_workspace) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  insert into notification (id, workspace_id, actor_id, reason, object_type, object_id, what, deliver_after)
  select x.id, p_workspace, x.actor, x.reason, p_type, p_object, x.what, x.at
  from unnest(p_ids, p_actors, p_reasons, p_whats, p_ats) as x(id, actor, reason, what, at)
  join membership m on m.workspace_id = p_workspace and m.actor_id = x.actor
    and m.deleted_at is null and m.joined_at is not null;
end
$$;
grant execute on function notify_many to tracker_app;

/* The merge's question, answered from an index rather than a walk. */
create index notification_waiting on notification (actor_id, object_id)
  where read_at is null and delivered_at is null and deleted_at is null;
