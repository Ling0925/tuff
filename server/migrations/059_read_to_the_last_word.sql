/*
 * A room is read up to its last word, not up to the clock.
 *
 * `mark_read` wrote `now()`, and the count is "messages newer than the
 * mark" — so a message whose `created_at` is ahead of the server's clock is
 * unread the instant after it has been read, for ever. The badge sat on a
 * room that had just been opened, the line in the history kept saying two
 * new messages, and opening it again did nothing, because opening it again
 * wrote `now()` again.
 *
 * It was found in a channel filled with demo data written a few hours into
 * the day, which is the kind of thing a fixture, an import or a migration
 * does. It is also what clock skew between two app servers does, and that
 * one does not announce itself.
 *
 * Reading a room means having seen everything in it: the screen draws every
 * message it holds, newest at the bottom, whatever their timestamps say. So
 * the mark is the newest message, or now when that is later or there are no
 * messages at all — never earlier than now, or re-reading an old room would
 * walk the mark backwards.
 */
create or replace function mark_read(p_conversation uuid, p_actor uuid, p_workspace uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  at timestamptz;
begin
  select greatest(now(), max(m.created_at)) into at
  from message m
  where m.conversation_id = p_conversation and m.deleted_at is null;

  insert into conversation_member (id, workspace_id, conversation_id, actor_id, last_read_at)
  values (gen_random_uuid(), p_workspace, p_conversation, p_actor, coalesce(at, now()))
  on conflict (conversation_id, actor_id) where deleted_at is null
  do update set last_read_at = greatest(conversation_member.last_read_at, excluded.last_read_at),
                updated_at = now();
end $$;
