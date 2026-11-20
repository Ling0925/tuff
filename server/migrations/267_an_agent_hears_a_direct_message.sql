/*
 * An agent hears what is said to it in a direct conversation,
 *
 * A message to an agent in a conversation of the two of them is now a
 * mention of it (`notify.ts`), and a mention in a direct conversation
 * still woke no webhook: what the agent hears asked for the thing's
 * project and stopped when there was none, and a direct conversation has
 * none. Where there is no project, the agent must be in the room itself,
 * as a member who has joined it — the room is its own access rule, as it
 * is for the people in it. Everything else is migration 266's.
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
  if project is null and new.object_type::text = 'conversation' then
    if not exists (
      select 1 from conversation c
      join conversation_member cm on cm.conversation_id = c.id
      where c.id = new.object_id and c.workspace_id = new.workspace_id and c.deleted_at is null
        and cm.actor_id = new.actor_id and cm.deleted_at is null and cm.joined_at is not null) then
      return new;
    end if;
  elsif project is null or not exists (
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
