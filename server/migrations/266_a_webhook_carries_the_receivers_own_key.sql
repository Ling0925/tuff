/*
 * A webhook carries the receiver's own key, and an agent's may be a Claude
 * Code routine, and
 *
 * Many receivers take a request only with their own key in
 * `Authorization`: n8n's Header Auth, Make, Pipedream, a Grok bot behind
 * its own gateway. Tuff signed every delivery and sent nothing else, so an
 * agent connected to one of them could never be woken. Now a webhook may
 * hold one header value, sent as `Authorization` beside the signature.
 *
 * Sealed at rest as a second factor's seed is (`auth/seal.ts`, kind
 * `webhook`), and selectable by no application role, as the secret is not:
 * what the API says is `authorization_set`, a column the database works
 * out from whether there is one.
 */
alter table webhook add column if not exists authorization_enc text;
alter table webhook add column if not exists authorization_set boolean
  generated always as (authorization_enc is not null) stored;
grant select (authorization_set) on webhook to tracker_app;

/*
 * How an agent's webhook is sent. `tuff` is the signed JSON every webhook
 * has carried; a `claude_routine` is a Claude Code routine's API trigger,
 * which takes `{ "text": … }` with the routine's token in `Authorization`
 * and two headers of Anthropic's. Claude Code has no address of its own;
 * a routine's trigger is one. The workspace's own webhooks are `tuff`.
 */
alter table webhook add column if not exists shape text not null default 'tuff'
  check (shape in ('tuff', 'claude_routine'));
grant select (shape) on webhook to tracker_app;

/* The thirty-an-hour count reads a webhook's deliveries by time. */
create index if not exists webhook_delivery_recent on webhook_delivery (webhook_id, created_at);

/* What is due, with the key and the shape to send it in. The return type
   changes, so it is dropped first. */
drop function if exists due_webhook_deliveries(int, uuid);
create or replace function due_webhook_deliveries(p_limit int, p_workspace uuid default null)
returns table (
  id uuid, url text, secret text, auth_enc text, shape text, event text, payload jsonb, attempts int
)
language sql volatile security definer set search_path = public, pg_temp as $$
  with picked as (
    select d.id
    from webhook_delivery d join webhook w on w.id = d.webhook_id
    where d.delivered_at is null and d.deliver_after <= now() and w.enabled
      and d.attempts < 10
      and (p_workspace is null or d.workspace_id = p_workspace)
    order by d.deliver_after
    limit p_limit
    for update of d skip locked
  ), claimed as (
    update webhook_delivery d set deliver_after = now() + interval '5 minutes'
    from picked where d.id = picked.id
    returning d.id, d.webhook_id, d.event, d.payload, d.attempts
  )
  select c.id, w.url, w.secret_enc, w.authorization_enc, w.shape, c.event, c.payload, c.attempts
  from claimed c join webhook w on w.id = c.webhook_id
$$;
revoke all on function due_webhook_deliveries(int, uuid) from public;
grant execute on function due_webhook_deliveries(int, uuid) to tracker_app;

/*
 * An agent's webhook's key, set, replaced or taken off (`p_sealed` null)
 * by whoever manages the agent (`agent_may_be_managed`, migration 264).
 * Through a definer because the webhook table lets only the owner write,
 * and a member who connected an agent manages it too. Answers the webhook
 * and whether it had one, for the audit line; nothing for an agent that is
 * not this caller's to manage or has no webhook.
 */
create or replace function agent_webhook_authorization(p_agent uuid, p_sealed text)
returns table (id uuid, url text, shape text, had boolean)
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  w record;
begin
  if not agent_may_be_managed(p_agent) then
    return;
  end if;
  select h.id, h.url, h.shape, h.authorization_enc is not null as had into w
  from webhook h
  where h.agent_id = p_agent and h.workspace_id = current_workspace() and h.deleted_at is null
  for update;
  if not found then
    return;
  end if;
  update webhook set authorization_enc = p_sealed where webhook.id = w.id;
  return query select w.id, w.url, w.shape, w.had;
end $$;
revoke all on function agent_webhook_authorization(uuid, text) from public;
grant execute on function agent_webhook_authorization(uuid, text) to tracker_app;

/* How it is sent, set at connecting by whoever connected it. */
create or replace function agent_webhook_shape(p_agent uuid, p_shape text) returns boolean
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  if not agent_may_be_managed(p_agent) or p_shape not in ('tuff', 'claude_routine') then
    return false;
  end if;
  update webhook set shape = p_shape
  where agent_id = p_agent and workspace_id = current_workspace() and deleted_at is null;
  return found;
end $$;
revoke all on function agent_webhook_shape(uuid, text) from public;
grant execute on function agent_webhook_shape(uuid, text) to tracker_app;

/* Whether an agent's webhook holds a key, and its shape: told to whoever
   manages the agent, nothing to anybody else or for an agent with no
   webhook. */
create or replace function agent_webhook_said(p_agent uuid)
returns table (authorization_set boolean, shape text)
language sql stable security definer set search_path = public, pg_temp as $$
  select h.authorization_enc is not null, h.shape from webhook h
  where agent_may_be_managed(p_agent)
    and h.agent_id = p_agent and h.workspace_id = current_workspace() and h.deleted_at is null
  limit 1
$$;
revoke all on function agent_webhook_said(uuid) from public;
grant execute on function agent_webhook_said(uuid) to tracker_app;

/*
 * What an agent hears, as migration 259 had it, saying three more things:
 * who did it (`by_name`), what it is called (`title`: the task's, the
 * announcement's, the document's or the room's), and where it opens
 * (`path`, the address without the site) — what a routine's one line of
 * text needs, and what any receiver would otherwise ask the API for.
 *
 * And a routine is sent thirty an hour at most: Anthropic takes no more
 * from one routine, and a fire past that is refused and retried for
 * nothing. What is past it is not queued.
 */
create or replace function agent_hears() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  project uuid;
  handle text;
  title text;
  path text;
  ws text;
begin
  if new.reason not in ('assigned', 'mentioned') or new.chain is null then
    return new;
  end if;
  if exists (select 1 from workspace w where w.id = new.workspace_id and w.plan = 'solo') then
    return new;
  end if;
  project := case new.object_type::text
    when 'task' then (select t.project_id from task t where t.id = new.object_id)
    when 'post' then (select p.project_id from post p where p.id = new.object_id)
    when 'file' then (select f.project_id from file f where f.id = new.object_id)
    when 'conversation' then (select c.project_id from conversation c where c.id = new.object_id)
  end;
  if project is null or not exists (
    select 1 from project_member pm
    where pm.project_id = project and pm.actor_id = new.actor_id and pm.deleted_at is null) then
    return new;
  end if;
  handle := case when new.object_type::text = 'task' then (
    select pr.key || '-' || t.number from task t join project pr on pr.id = t.project_id where t.id = new.object_id) end;
  select w.slug::text into ws from workspace w where w.id = new.workspace_id;
  if new.object_type::text = 'task' then
    select t.title, '/' || ws || '/' || pr.slug || '/tasks/' || t.number into title, path
    from task t join project pr on pr.id = t.project_id where t.id = new.object_id;
  elsif new.object_type::text = 'post' then
    select p.title, '/' || ws || '/' || pr.slug || '/posts/' || p.number into title, path
    from post p join project pr on pr.id = p.project_id where p.id = new.object_id;
  elsif new.object_type::text = 'file' then
    select f.name, '/' || ws || '/' || pr.slug || '/files/' || f.number into title, path
    from file f join project pr on pr.id = f.project_id where f.id = new.object_id;
  else
    /* A room of chosen people says its name only to an agent in it,
       the third audit. */
    select c.name, '/' || ws || '/chat/' || c.id into title, path
    from conversation c where c.id = new.object_id
      and (not c.chosen or exists (
        select 1 from conversation_member cm
        where cm.conversation_id = c.id and cm.actor_id = new.actor_id
          and cm.deleted_at is null and cm.joined_at is not null));
    if not found then
      return new;
    end if;
  end if;

  /* One count at a time per routine, so two notes at once cannot both
     find twenty-nine and make thirty-one. */
  perform pg_advisory_xact_lock(hashtext(w.id::text))
  from webhook w
  where w.agent_id = new.actor_id and w.workspace_id = new.workspace_id
    and w.shape = 'claude_routine' and w.enabled and w.deleted_at is null;

  insert into webhook_delivery (id, workspace_id, webhook_id, event, payload)
  select gen_random_uuid(), new.workspace_id, w.id,
         case new.reason when 'assigned' then 'agent.assigned' else 'agent.mentioned' end,
         jsonb_build_object('agent_id', g.actor_id, 'reason', new.reason::text,
                            'object_type', new.object_type::text, 'object_id', new.object_id,
                            'handle', handle, 'what', new.what, 'chain', new.chain,
                            'by_name', (select a.name from actor a where a.id = new.by_id),
                            'title', title, 'path', path)
  from agent g
  join webhook w on w.agent_id = g.actor_id and w.workspace_id = g.workspace_id
    and w.enabled and w.deleted_at is null
  where g.actor_id = new.actor_id and g.workspace_id = new.workspace_id and g.deleted_at is null
    and g.reach = 'webhook'
    and (w.shape <> 'claude_routine' or (
      select count(*) from webhook_delivery d
      where d.webhook_id = w.id and d.created_at > now() - interval '1 hour') < 30);
  return new;
end $$;
