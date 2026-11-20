/*
 * Whether somebody may read a task, an announcement or a file — asked about
 * them, by somebody else. `docs/specs/task-mentions.md`.
 *
 * A name typed into a body tells the person it names, and the person who
 * typed it decides nothing about who that is: an agent, a GitHub issue or
 * an import can name anybody in the workspace. Somebody who cannot read the
 * thing was written a note about it — the inbox hid it, the push and the
 * email were stopped as they went (`stillSees`), but the row was there and
 * the live ping reached them.
 *
 * The question has to be the one row-level security asks, not a copy of
 * it: two rules for "may read a project" agree until one of them changes.
 * So this asks the read policies' own functions — `visible_projects()` and
 * `visible_conversations()` — with the reader set to the person named, for
 * the length of the question, and puts the asker back. The workspace stays
 * the asker's session's, which is the only one the person named can be told
 * in.
 */
create or replace function may_read(p_actor uuid, p_kind object_kind, p_id uuid) returns boolean
language plpgsql volatile security definer set search_path = public as $$
declare
  asker text := current_setting('app.actor_id', true);
  ws uuid;
  ok boolean := false;
begin
  select coalesce(
    (select workspace_id from task where p_kind = 'task' and id = p_id),
    (select workspace_id from post where p_kind = 'post' and id = p_id),
    (select workspace_id from file where p_kind = 'file' and id = p_id)
  ) into ws;
  /* Only somebody of the thing's workspace asks, and only in the one their
     session is in: what does not exist, or is not theirs to ask about, is
     read by nobody. */
  if ws is null or not is_member(ws) or (current_workspace() is not null and ws <> current_workspace()) then
    return false;
  end if;
  perform set_config('app.actor_id', p_actor::text, true);
  begin
    if p_kind = 'task' then
      select exists (
        select 1 from task t
        where t.id = p_id and t.deleted_at is null
          and t.project_id in (select visible_projects())
      ) into ok;
    elsif p_kind = 'post' then
      select exists (
        select 1 from post x
        where x.id = p_id and x.deleted_at is null
          and x.project_id in (select visible_projects())
      ) into ok;
    elsif p_kind = 'file' then
      /* As `o_read` on file has it since 137: the project, and the room it
         was sent in when it was sent in one. */
      select exists (
        select 1 from file f
        where f.id = p_id and f.deleted_at is null
          and (f.project_id is null or f.project_id in (select visible_projects()))
          and (f.conversation_id is null or f.conversation_id in (select visible_conversations()))
      ) into ok;
    end if;
    /* And, whatever the thing, somebody of its workspace: a file outside
       every project is the workspace's, and `visible_projects` is bounded
       by the session's workspace only when the session has one. */
    ok := ok and exists (select 1 from membership m where m.workspace_id = ws
                           and m.actor_id = p_actor and m.deleted_at is null and m.joined_at is not null);
  exception when others then
    perform set_config('app.actor_id', coalesce(asker, ''), true);
    raise;
  end;
  perform set_config('app.actor_id', coalesce(asker, ''), true);
  return ok;
end
$$;

grant execute on function may_read(uuid, object_kind, uuid) to tracker_app;

/*
 * Of these people, the ones with a mention of this thing they have not read
 * yet. A name taken out and put back — an edit undone with ⌘Z, a sentence
 * rewritten — is not a second mention: they have not looked at the first.
 * A definer function because a note is its owner's row, as `subscribers`
 * is for a subscription.
 */
create or replace function already_named(p_actors uuid[], p_kind object_kind, p_id uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select distinct n.actor_id from notification n
  where is_member(n.workspace_id)
    and (current_workspace() is null or n.workspace_id = current_workspace())
    and n.actor_id = any(p_actors) and n.reason = 'mentioned'
    and n.object_type = p_kind and n.object_id = p_id
    and n.read_at is null and n.deleted_at is null
$$;

grant execute on function already_named(uuid[], object_kind, uuid) to tracker_app;
