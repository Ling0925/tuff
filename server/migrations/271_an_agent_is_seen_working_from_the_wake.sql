/*
 * An agent is seen at work from the moment it is woken, not from when its
 * receiver answers.
 *
 * The worker marked the room only after the delivery came back, and a bot
 * that runs its model before it answers held that for its whole run (or
 * the ten seconds a request is given): the window said nothing while the
 * agent worked, and only a reload, reading the room's list, showed it. Now
 * the room is marked as the wake goes out, and a wake the receiver refused
 * takes the mark off again — this function, for that delivery's agent and
 * room, and only while the mark is still the one this wake made.
 */
create function agent_wake_refused(p_delivery uuid)
returns table (conversation_id uuid, agent_id uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  d record;
begin
  select x.workspace_id, (x.payload->>'agent_id')::uuid as agent, (x.payload->>'object_id')::uuid as room
  into d
  from webhook_delivery x
  where x.id = p_delivery and x.event = 'agent.mentioned' and x.payload->>'object_type' = 'conversation';
  if not found then
    return;
  end if;
  delete from agent_woken w
  where w.agent_id = d.agent and w.conversation_id = d.room and w.workspace_id = d.workspace_id;
  if found then
    conversation_id := d.room;
    agent_id := d.agent;
    return next;
  end if;
end $$;
revoke all on function agent_wake_refused(uuid) from public;
grant execute on function agent_wake_refused(uuid) to tracker_app;
