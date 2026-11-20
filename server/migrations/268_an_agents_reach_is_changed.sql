/*
 * How an agent is reached, changed after it was connected.
 * MCP, a webhook, or a
 * Claude Code routine, and the webhook's or the routine's address; before
 * this the only way was to disconnect it and connect another.
 *
 * Whoever manages the agent (`agent_may_be_managed`, migration 264), through
 * a definer because the webhook table lets only the owner write.
 */

/*
 * `p_reach` `mcp` stops its webhook: turned off and deleted, its address,
 * its secret and its key dropped with it, and what was queued for it
 * cancelled, so nothing more is sent and nothing is kept.
 *
 * `webhook` points its webhook at `p_url` in `p_shape`, or makes one with
 * `p_secret` when it has none. A new address or a new shape is a new
 * receiver, and in the same statement:
 *   - the receiver's key is taken off: a key given for one host is never
 *     sent to another;
 *   - the signing secret is replaced with `p_secret`, so the old receiver's
 *     copy no longer signs anything the new one is sent;
 *   - what was queued and not yet delivered is cancelled: those events were
 *     meant for the receiver it had.
 * The address itself is checked by the caller, as at connecting.
 *
 * Answers what it was and what happened, for the audit line — `new_secret`
 * when the secret is now `p_secret`, for the caller to say once; nothing
 * for an agent that is not this caller's to manage.
 */
drop function if exists agent_reach(uuid, text, text, text, text);
create function agent_reach(p_agent uuid, p_reach text, p_url text, p_shape text, p_secret text)
returns table (
  was_reach text, was_url text, was_shape text, had_key boolean, cleared boolean, hook_id uuid, new_secret boolean
)
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  ws uuid := current_workspace();
  g record;
  h record;
  has_hook boolean;
  moved boolean;
  fresh uuid;
begin
  if not agent_may_be_managed(p_agent) or p_reach not in ('mcp', 'webhook')
     or (p_reach = 'webhook') <> (p_url is not null)
     or (p_reach = 'webhook' and (p_shape is null or p_shape not in ('tuff', 'claude_routine'))) then
    return;
  end if;
  select a.reach into g from agent a
  where a.actor_id = p_agent and a.workspace_id = ws and a.deleted_at is null
  for update;
  if not found then
    return;
  end if;
  select w.id, w.url, w.shape, w.authorization_enc is not null as had into h
  from webhook w
  where w.agent_id = p_agent and w.workspace_id = ws and w.deleted_at is null
  for update;
  has_hook := found;

  if p_reach = 'mcp' then
    update agent set reach = 'mcp' where actor_id = p_agent and workspace_id = ws;
    if has_hook then
      /* The columns are not null: emptied rather than nulled. */
      update webhook set enabled = false, deleted_at = now(), authorization_enc = null,
                         url = '', secret_enc = '', updated_at = now()
      where webhook.id = h.id;
      delete from webhook_delivery where webhook_id = h.id and delivered_at is null;
      return query select g.reach, h.url, h.shape, h.had, h.had, h.id, false;
    else
      return query select g.reach, null::text, null::text, false, false, null::uuid, false;
    end if;
    return;
  end if;

  if p_secret is null then
    raise exception 'agent_reach: a webhook needs its secret';
  end if;
  update agent set reach = 'webhook' where actor_id = p_agent and workspace_id = ws;
  if not has_hook then
    fresh := gen_random_uuid();
    insert into webhook (id, workspace_id, url, events, secret_enc, created_by, agent_id, shape)
    values (fresh, ws, p_url, '{}', p_secret, current_actor(), p_agent, p_shape);
    return query select g.reach, null::text, null::text, false, false, fresh, true;
    return;
  end if;
  moved := h.url is distinct from p_url or h.shape is distinct from p_shape;
  if not moved then
    return query select g.reach, h.url, h.shape, h.had, false, h.id, false;
    return;
  end if;
  update webhook set
    url = p_url,
    shape = p_shape,
    authorization_enc = null,
    secret_enc = p_secret,
    updated_at = now()
  where webhook.id = h.id;
  delete from webhook_delivery where webhook_id = h.id and delivered_at is null;
  return query select g.reach, h.url, h.shape, h.had, h.had, h.id, true;
end $$;
revoke all on function agent_reach(uuid, text, text, text, text) from public;
grant execute on function agent_reach(uuid, text, text, text, text) to tracker_app;

/* What its webhook says, now with its address: the page that changes it
   starts from it. To whoever manages the agent, as before. The return
   type changes, so it is dropped first. */
drop function if exists agent_webhook_said(uuid);
create function agent_webhook_said(p_agent uuid)
returns table (authorization_set boolean, shape text, url text)
language sql stable security definer set search_path = public, pg_temp as $$
  select h.authorization_enc is not null, h.shape, h.url from webhook h
  where agent_may_be_managed(p_agent)
    and h.agent_id = p_agent and h.workspace_id = current_workspace() and h.deleted_at is null
  limit 1
$$;
revoke all on function agent_webhook_said(uuid) from public;
grant execute on function agent_webhook_said(uuid) to tracker_app;

/* `agent.reach` in the audit log, beside connecting and disconnecting one
   (migration 265). */
drop index if exists activity_audit;
create index activity_audit on activity_event (workspace_id, at desc, id desc)
  where action in (
    'people.remove', 'people.rights',
    'project.member.add', 'project.member.remove', 'project.member.rights', 'project.leave',
    'workspace.settings',
    'project.delete', 'project.restore',
    'slack.connect', 'slack.disconnect', 'github.install', 'github.remove',
    'agent.connect', 'agent.disconnect', 'webhook.create', 'webhook.remove',
    'webhook.update', 'agent.reach'
  );

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
         'webhook.update', 'agent.reach'
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
