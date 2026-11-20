/*
 * An agent called in a room is seen working there,
 *
 * Asked in a thread to look at a project's Triage, a Grok agent worked for
 * three minutes and the thread showed nothing: no word that it had taken
 * it up. Two things now say so, under the line where who is typing is
 * said:
 *
 * - A wake. When a delivery that woke an agent for a message in a room is
 *   settled — answered, or timed out (`agents.md`, "Waking, once") — the
 *   worker records it here, one row an agent a room, with the thread it
 *   was called in. Shown for five minutes, or until it writes there.
 * - A status that names the room. `agent_doing` gains the conversation and
 *   the thread, and is then read only by whoever can see that room.
 *
 * A table rather than the process's memory, as typing is kept: the wake is
 * seen by the worker and read by the API, two processes, and a person who
 * opens the thread a minute later must find it there.
 */
create table agent_woken (
  agent_id uuid not null references actor(id) on delete cascade,
  workspace_id uuid not null references workspace(id) on delete cascade,
  conversation_id uuid not null references conversation(id) on delete cascade,
  /* The thread it was called in — the message's parent — or null for the
     room's own line; and the message itself, since a thread opened on that
     message is where its answer will go. */
  thread_id uuid,
  message_id uuid,
  at timestamptz not null default now(),
  primary key (agent_id, conversation_id)
);
create index agent_woken_in_room on agent_woken (conversation_id);

alter table agent_woken enable row level security;

/* Seen by whoever can see the room — a chosen room's, by its people. */
create policy aw_read on agent_woken for select to tracker_app using (
  workspace_id = current_workspace() and can_see_conversation(conversation_id)
);
grant select on agent_woken to tracker_app;

/* The one place the five minutes are written. */
create function agent_woken_until(said timestamptz) returns timestamptz
language sql immutable as $$ select said + interval '5 minutes' $$;
grant execute on function agent_woken_until(timestamptz) to tracker_app;

/*
 * A wake settled, recorded. As the tables' owner: the worker has no actor.
 * Only a mention in a room, of an agent still there; the message is the
 * one the inbox quotes for the same note — the latest naming the agent, or
 * any line of the other's in a conversation of two — and with none found
 * nothing is recorded. Answers the room and the agent, for the socket.
 */
create function agent_was_woken(p_delivery uuid)
returns table (conversation_id uuid, agent_id uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  d record;
  m record;
begin
  select x.workspace_id, x.created_at, (x.payload->>'agent_id')::uuid as agent, (x.payload->>'object_id')::uuid as room
  into d
  from webhook_delivery x
  where x.id = p_delivery and x.event = 'agent.mentioned' and x.payload->>'object_type' = 'conversation';
  if not found then
    return;
  end if;
  select msg.id, msg.parent_id into m
  from message msg join conversation c on c.id = msg.conversation_id and c.deleted_at is null
  where msg.conversation_id = d.room and msg.workspace_id = d.workspace_id and msg.deleted_at is null
    and msg.author_id <> d.agent
    and msg.created_at <= d.created_at + interval '5 seconds'
    and msg.created_at >= d.created_at - interval '10 minutes'
    and (msg.body::text like '%' || d.agent::text || '%'
         or (not c.channel and c.project_id is null
             and (select count(*) from conversation_member cm
                  where cm.conversation_id = c.id and cm.deleted_at is null and cm.joined_at is not null) = 2))
  order by msg.created_at desc
  limit 1;
  if not found then
    return;
  end if;
  insert into agent_woken (agent_id, workspace_id, conversation_id, thread_id, message_id, at)
  values (d.agent, d.workspace_id, d.room, m.parent_id, m.id, now())
  on conflict on constraint agent_woken_pkey do update
    set thread_id = excluded.thread_id, message_id = excluded.message_id, at = excluded.at;
  conversation_id := d.room;
  agent_id := d.agent;
  return next;
end $$;
revoke all on function agent_was_woken(uuid) from public;
grant execute on function agent_was_woken(uuid) to tracker_app;

/*
 * A status can name the room it is said for, and the thread. Read then by
 * whoever can see that room and no one else: a status in a chosen room is
 * its people's, as everything said there is.
 */
alter table agent_doing add column conversation_id uuid references conversation(id) on delete set null;
alter table agent_doing add column thread_id uuid;
create index agent_doing_in_room on agent_doing (conversation_id) where conversation_id is not null;

alter policy ad_read on agent_doing using (
  workspace_id = current_workspace() and is_member(workspace_id)
  and (agent_id = current_actor()
       or ((task_id is null
            or exists (select 1 from task t where t.id = agent_doing.task_id and t.deleted_at is null))
           and (conversation_id is null or can_see_conversation(conversation_id))))
);
alter policy ad_say on agent_doing with check (
  workspace_id = current_workspace() and agent_id = current_actor()
  and exists (select 1 from agent g where g.actor_id = agent_doing.agent_id
                and g.workspace_id = agent_doing.workspace_id and g.deleted_at is null)
  and (task_id is null
       or exists (select 1 from task t where t.id = agent_doing.task_id and t.deleted_at is null))
  and (conversation_id is null or can_see_conversation(conversation_id))
);
alter policy ad_say_again on agent_doing
  using (workspace_id = current_workspace() and agent_id = current_actor())
  with check (
    workspace_id = current_workspace() and agent_id = current_actor()
    and exists (select 1 from agent g where g.actor_id = agent_doing.agent_id
                  and g.workspace_id = agent_doing.workspace_id and g.deleted_at is null)
    and (task_id is null
         or exists (select 1 from task t where t.id = agent_doing.task_id and t.deleted_at is null))
    and (conversation_id is null or can_see_conversation(conversation_id))
  );

/*
 * Writing in the room is the answer: the wake is let go, and a status
 * stops naming the room (it still names its task, if it had one). As the
 * tables' owner, whoever wrote — the rows are the agent's.
 */
create function agent_answered_in_room() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from agent_woken w where w.agent_id = new.author_id and w.conversation_id = new.conversation_id;
  update agent_doing d set conversation_id = null, thread_id = null
  where d.agent_id = new.author_id and d.conversation_id = new.conversation_id;
  return new;
end $$;
revoke all on function agent_answered_in_room() from public;
create trigger agent_answered_in_room
  after insert on message
  for each row execute function agent_answered_in_room();

/*
 * An agent saying it has stopped (`doing: null`) is done in its rooms too.
 * Its own rows only — the caller's, never a name passed in. Answers the
 * rooms whose screens should hear of it.
 */
create function agent_let_go() returns table (conversation_id uuid)
language sql security definer set search_path = public, pg_temp as $$
  delete from agent_woken w
  where w.agent_id = current_actor() and w.workspace_id = current_workspace()
  returning w.conversation_id
$$;
revoke all on function agent_let_go() from public;
grant execute on function agent_let_go() to tracker_app;
