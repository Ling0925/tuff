/*
 * A line brought from Slack is somebody in the room's, and said before it
 * was brought.
 *
 * An import matched an email to anybody in the workspace and wrote the line
 * in their name. A member opened a direct room with a colleague, brought one
 * line across "from" the owner, dated last month, and it was drawn with the
 * owner's face in a room the owner had never seen.
 *
 * Whether a line may carry somebody else's name at all is the server's to
 * decide — `content.edit.said`, the right to change what somebody said, in
 * `can`. What is kept here is the part no handler should be trusted with:
 * nobody is made the author of a line in a room they cannot read, and
 * nothing is dated after now. A reply already hangs off a message of the
 * same room or nowhere (`109_what_the_audit_found.sql`).
 */

/* Whether somebody — not the asker — can read a room the asker can read.
   `can_see_conversation`'s rule, about another person. */
create function sees_conversation(p_conversation uuid, p_actor uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select can_see_conversation(p_conversation) and exists (
    select 1 from conversation cv
    join membership m on m.workspace_id = cv.workspace_id and m.actor_id = p_actor
      and m.deleted_at is null and m.joined_at is not null
    where cv.id = p_conversation and cv.deleted_at is null
      and (
        cv.project_id is null or m.role = 'owner'
        or exists (
          select 1 from project_member pm
          where pm.project_id = cv.project_id and pm.actor_id = p_actor and pm.deleted_at is null
        )
      )
      and (
        exists (
          select 1 from conversation_member cm
          where cm.conversation_id = cv.id and cm.actor_id = p_actor
            and cm.joined_at is not null and cm.deleted_at is null
        )
        or (
          cv.project_id is not null
          and not exists (
            select 1 from conversation_member cm
            where cm.conversation_id = cv.id and cm.joined_at is not null and cm.deleted_at is null
          )
        )
      )
  )
$$;
grant execute on function sees_conversation(uuid, uuid) to tracker_app;

create or replace function import_message(
  p_id uuid, p_workspace uuid, p_conversation uuid, p_author uuid, p_parent uuid,
  p_body jsonb, p_said_as text, p_at timestamptz
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if current_actor() is null or p_workspace is distinct from current_workspace() then
    raise exception 'not here' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from conversation where id = p_conversation and workspace_id = p_workspace)
     or not can_see_conversation(p_conversation) then
    raise exception 'not a room you can see' using errcode = 'insufficient_privilege';
  end if;
  if p_author <> current_actor() and not sees_conversation(p_conversation, p_author) then
    raise exception 'not somebody in this room' using errcode = 'insufficient_privilege';
  end if;
  if p_at > now() then
    raise exception 'not said yet' using errcode = 'check_violation';
  end if;
  insert into message (id, workspace_id, conversation_id, author_id, parent_id, body,
                       origin, said_as, created_at, updated_at)
  values (p_id, p_workspace, p_conversation, p_author, p_parent, p_body,
          'import', p_said_as, p_at, p_at);
end $$;
