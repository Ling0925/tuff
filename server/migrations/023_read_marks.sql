-- Where somebody has read up to in a conversation.
--
-- Unread was nowhere in the product: the sidebar showed every room the same
-- whether it had been quiet for a week or had nine messages since you looked.
-- A chat you have to open to find out whether it wants you is a chat people
-- open constantly and then stop opening at all.
--
-- One timestamp per person per room. Not per message: read receipts are a
-- different feature with different privacy questions, and this is the one
-- that makes the list useful.
alter table conversation_member add column last_read_at timestamptz;

/*
 * A project channel has no membership row for the people who can see it by
 * being on the project, so the mark has to be able to arrive first and the
 * row be made for it.
 */
create function mark_read(p_conversation uuid, p_actor uuid, p_workspace uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into conversation_member (id, workspace_id, conversation_id, actor_id, last_read_at)
  values (gen_random_uuid(), p_workspace, p_conversation, p_actor, now())
  on conflict (conversation_id, actor_id) where deleted_at is null
  do update set last_read_at = now(), updated_at = now();
end $$;

grant execute on function mark_read to tracker_app;
