/*
 * A note says who did it, and what kind of thing they did —
 * `docs/specs/inbox.md`, "Who, and what kind".
 *
 * The inbox drew every note with the same disc and a glyph for why it came,
 * and the person behind it was only a name inside a sentence. A row now
 * carries their face, so the note needs to know whose: `by_id`, the actor
 * whose action wrote it. `kind` is what they did — `commented`, `finished`,
 * `moved` — so a note about something you watch can wear the glyph of what
 * happened rather than the bell every one of them wore. Both are null for a
 * note nobody did (a reminder of a date) and for every note written before.
 *
 * `by_id` is never taken on trust: the functions write the caller, whatever
 * they are passed, because a note that names somebody else as its author is
 * a note that puts words in their mouth.
 */
alter table notification add column by_id uuid references actor(id);
alter table notification add column kind text;

drop function notify_once(uuid, uuid, uuid, notify_reason, object_kind, uuid, text, timestamptz, boolean);
drop function notify_many(uuid, uuid[], uuid[], notify_reason[], object_kind, uuid, text[], timestamptz[]);

/*
 * As in migration 128, with who and what kind. A merged note takes both
 * from the last thing done, as it already took the line: the note says the
 * last of a burst, and its face is whoever did that.
 */
create function notify_once(
  p_id uuid, p_workspace uuid, p_actor uuid, p_reason notify_reason, p_type object_kind,
  p_object uuid, p_what text, p_after timestamptz, p_merge boolean, p_kind text, p_by boolean
) returns void
language plpgsql security definer set search_path = public as $$
declare
  waiting uuid;
  doer uuid := case when p_by then current_actor() end;
begin
  if not is_member(p_workspace) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  if not exists (select 1 from membership where workspace_id = p_workspace and actor_id = p_actor
                   and deleted_at is null and joined_at is not null) then
    return;
  end if;
  if p_merge then
    select id into waiting from notification
    where actor_id = p_actor and workspace_id = p_workspace and reason = p_reason
      and object_type = p_type and object_id = p_object
      and read_at is null and delivered_at is null and deleted_at is null
    order by created_at desc limit 1
    for update;
    if waiting is not null then
      update notification
      set what = coalesce(p_what, what), kind = coalesce(p_kind, kind), by_id = coalesce(doer, by_id),
          deliver_after = greatest(deliver_after, p_after),
          created_at = now(), updated_at = now()
      where id = waiting;
      return;
    end if;
  end if;
  insert into notification (id, workspace_id, actor_id, reason, object_type, object_id, what, deliver_after, kind, by_id)
  values (p_id, p_workspace, p_actor, p_reason, p_type, p_object, p_what, p_after, p_kind, doer);
end
$$;
grant execute on function notify_once to tracker_app;

/* Notes that are never merged, written in one statement — by the caller. */
create function notify_many(
  p_workspace uuid, p_ids uuid[], p_actors uuid[], p_reasons notify_reason[],
  p_type object_kind, p_object uuid, p_whats text[], p_ats timestamptz[], p_kinds text[]
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_member(p_workspace) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  insert into notification (id, workspace_id, actor_id, reason, object_type, object_id, what, deliver_after, kind, by_id)
  select x.id, p_workspace, x.actor, x.reason, p_type, p_object, x.what, x.at, x.kind, current_actor()
  from unnest(p_ids, p_actors, p_reasons, p_whats, p_ats, p_kinds) as x(id, actor, reason, what, at, kind)
  join membership m on m.workspace_id = p_workspace and m.actor_id = x.actor
    and m.deleted_at is null and m.joined_at is not null;
end
$$;
grant execute on function notify_many to tracker_app;
