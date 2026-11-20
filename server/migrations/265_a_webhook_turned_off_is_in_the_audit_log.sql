/*
 * A webhook turned off or on, or its events changed, is a line in the audit
 * log. Turning one off stops a workspace's work
 * reaching wherever it was going, which is the kind of change the owner
 * reads the log to find. Written as `webhook.update` with its host, whether
 * it is on and its events; read here beside `webhook.create` and
 * `webhook.remove` (migration 183).
 */
drop index if exists activity_audit;
create index activity_audit on activity_event (workspace_id, at desc, id desc)
  where action in (
    'people.remove', 'people.rights',
    'project.member.add', 'project.member.remove', 'project.member.rights', 'project.leave',
    'workspace.settings',
    'project.delete', 'project.restore',
    'slack.connect', 'slack.disconnect', 'github.install', 'github.remove',
    'agent.connect', 'agent.disconnect', 'webhook.create', 'webhook.remove',
    'webhook.update'
  );

/*
 * A page of the log.
 *
 * `p_kinds` null is every kind; `p_who` is a person the line is by or about
 * — the one who did it, or the one it was done to (`meta.actor_id`, or
 * `meta.to` for the hand-over); `p_at` and `p_id` are the last line of the
 * page before, a cursor that cannot skip or repeat a line two events share
 * a moment with.
 */
create or replace function audit_page(p_kinds text[], p_who uuid, p_at timestamptz, p_id uuid, p_limit int)
returns table (
  id uuid, kind text, at timestamptz, ip text, user_agent text, meta jsonb, origin text,
  actor_id uuid, actor_name text, subject_id uuid, subject_name text,
  project_id uuid, project_name text
)
language sql stable security definer set search_path = public, pg_temp as $$
  with here as (
    select current_workspace() as ws where role_in(current_workspace()) = 'owner'
  ),
  lines as (
    (select s.id, s.kind, s.at, s.ip, s.user_agent, s.meta, null::text as origin, s.actor_id,
            null::uuid as project_id
     from security_event s, here
     where s.workspace_id = here.ws
       and (p_kinds is null or s.kind = any(p_kinds))
       and (p_who is null or s.actor_id = p_who
            or s.meta->>'actor_id' = p_who::text or s.meta->>'to' = p_who::text)
       and (p_at is null or s.at <= p_at)
       and (p_at is null or (s.at, s.id) < (p_at, p_id))
     order by s.at desc, s.id desc
     limit p_limit)
    union all
    (select a.id, a.action, a.at, null, null, a.meta, a.origin::text, a.actor_id, a.project_id
     from activity_event a, here
     where a.workspace_id = here.ws
       and a.action in (
         'people.remove', 'people.rights',
         'project.member.add', 'project.member.remove', 'project.member.rights', 'project.leave',
         'workspace.settings',
         'project.delete', 'project.restore',
         'slack.connect', 'slack.disconnect', 'github.install', 'github.remove',
         'agent.connect', 'agent.disconnect', 'webhook.create', 'webhook.remove',
         'webhook.update'
       )
       and (p_kinds is null or a.action = any(p_kinds))
       and (p_who is null or a.actor_id = p_who or a.meta->>'actor_id' = p_who::text)
       and (p_at is null or a.at <= p_at)
       and (p_at is null or (a.at, a.id) < (p_at, p_id))
     order by a.at desc, a.id desc
     limit p_limit)
  )
  select l.id, l.kind, l.at, l.ip, l.user_agent, l.meta, l.origin,
         l.actor_id, who.name,
         them.id, them.name,
         l.project_id, pr.name
  from (select * from lines order by at desc, id desc limit p_limit) l
  left join actor who on who.id = l.actor_id
  /* Whom it was done to, by name: the log is read by a person, months later. */
  left join actor them on them.id = case
      when coalesce(l.meta->>'actor_id', l.meta->>'to') ~ '^[0-9a-f-]{36}$'
      then coalesce(l.meta->>'actor_id', l.meta->>'to')::uuid end
  left join project pr on pr.id = l.project_id
  order by l.at desc, l.id desc
$$;
revoke all on function audit_page(text[], uuid, timestamptz, uuid, int) from public;
grant execute on function audit_page(text[], uuid, timestamptz, uuid, int) to tracker_app;
