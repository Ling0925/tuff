/*
 * Somebody followed your invitation — `docs/specs/inbox.md`.
 *
 * An invitation went out and nothing ever came back: whoever sent it found
 * out the person was in by noticing a new face in Members. `joined` is the
 * reason the inbox tells them, and `actor` is what the note is about — the
 * person, whose page is where it opens. Neither is a new entity: an actor is
 * the service record every member already has, and a note is a note.
 */
alter type notify_reason add value if not exists 'joined';
alter type object_kind add value if not exists 'actor';

/*
 * Who sent the invitation this person has just followed, if they are still
 * here to be told and are not the person themself.
 *
 * Read as nobody, because an invitation is the managers' to read and the
 * person joining is not one — asked as them, it says nobody sent it.
 */
create function inviter_of(p_workspace uuid, p_actor uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select i.created_by from invite i
  join membership m on m.workspace_id = i.workspace_id and m.actor_id = i.created_by
    and m.deleted_at is null
  where i.workspace_id = p_workspace and i.used_by = p_actor
    and i.created_by <> p_actor
  order by i.used_at desc nulls last
  limit 1
$$;
grant execute on function inviter_of to tracker_app;
