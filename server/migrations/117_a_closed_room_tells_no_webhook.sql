/*
 * What happens in a room only some people are in reaches no webhook.
 *
 * The queue took every event, and a webhook is the owner's: a receiver the
 * owner set up was sent the name of a direct conversation, or of a channel
 * of chosen people, and what was done in it — `layoffs-q3`, renamed, its
 * members changed — for rooms the owner could not open. A room is news to
 * the owner's receivers when it is open to everybody on its project, and
 * otherwise it is not news to anyone outside it. Asked here, beside the
 * secret it is signed with, and of the room as it was: a room deleted in the
 * same transaction still answers.
 */
create or replace function queue_webhooks(p_workspace uuid, p_event text, p_payload jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if current_workspace() is not null and p_workspace <> current_workspace() then
    return 0;
  end if;
  if p_payload->>'object_type' = 'conversation' and not exists (
    select 1 from conversation cv
    where cv.id = (p_payload->>'object_id')::uuid and cv.workspace_id = p_workspace
      and cv.project_id is not null
      and not exists (
        select 1 from conversation_member cm
        where cm.conversation_id = cv.id and cm.joined_at is not null and cm.deleted_at is null
      )
  ) then
    return 0;
  end if;
  insert into webhook_delivery (id, workspace_id, webhook_id, event, payload)
  select gen_random_uuid(), p_workspace, w.id, p_event, p_payload
  from webhook w
  where w.workspace_id = p_workspace and w.enabled and w.deleted_at is null
    and (cardinality(w.events) = 0 or p_event = any(w.events));
  get diagnostics n = row_count;
  return n;
end $$;
