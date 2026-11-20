/*
 * The rooms, as a set rather than a question asked per row.
 *
 * Migration 014 made this argument for the four entities and stopped there.
 * `can_see_conversation(conversation_id)` takes the row, so Postgres calls it
 * once per message — and each call runs three subqueries, one of which is
 * `can_read_object`, which runs two more. Counting what is unread in seven
 * rooms with twenty-three messages between them cost a hundred milliseconds,
 * and the load table has a million messages in one channel.
 *
 * Written as set membership, the set is computed once per query as a hashed
 * InitPlan and the check becomes a lookup. Same rule, same answers.
 *
 * `can_see_conversation` stays: it is the right shape for asking about one
 * room, which is what the endpoints do, and it is what migration 026's
 * `channel_members` is built on.
 */
create function visible_conversations() returns setof uuid
language sql stable security definer set search_path = public as $$
  select cv.id from conversation cv
  where cv.deleted_at is null and (
    -- A room somebody was put in. Chosen membership wins over the project.
    exists (
      select 1 from conversation_member cm
      where cm.conversation_id = cv.id and cm.actor_id = current_actor()
        and cm.joined_at is not null and cm.deleted_at is null
    )
    or (
      -- Or the project's own channel, which nobody was chosen for.
      cv.project_id is not null
      and cv.project_id in (select visible_projects())
      and (cv.project_id not in (select restricted_projects()) or cv.visible_to_client)
      and not exists (
        select 1 from conversation_member cm
        where cm.conversation_id = cv.id and cm.joined_at is not null
          and cm.deleted_at is null
      )
    )
  )
$$;

grant execute on function visible_conversations to tracker_app;

drop policy msg_read on message;
create policy msg_read on message for select
  using (conversation_id in (select visible_conversations()));

drop policy msg_write on message;
create policy msg_write on message for insert
  with check (
    conversation_id in (select visible_conversations()) and author_id = current_actor()
  );

drop policy msg_update on message;
create policy msg_update on message for update
  using (conversation_id in (select visible_conversations())) with check (true);

/*
 * The membership rows are read the same way, and for the same reason: the
 * sidebar asks who else is in every direct conversation it lists, which is a
 * per-row call for every row of every room.
 */
drop policy cm_read on conversation_member;
create policy cm_read on conversation_member for select
  using (conversation_id in (select visible_conversations()));

drop policy c_read on conversation;
create policy c_read on conversation for select using (id in (select visible_conversations()));
