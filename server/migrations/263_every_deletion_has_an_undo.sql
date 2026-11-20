/*
 * Every deletion has an Undo.
 *
 * A task, an announcement, a comment and a channel remember who deleted
 * them, as a row in Docs does since migration 262: Undo is theirs, or the
 * business of whoever may delete anybody's, and not the author's for thirty
 * days after somebody else took it down. Empty until something is deleted,
 * and set back to empty when it is restored; a row deleted before this, or
 * by the clear-out of a series (`repeat.ts`), has none and is restored only
 * by whoever may delete anybody's.
 *
 * Changes no rows.
 */
alter table task add column if not exists deleted_by uuid references actor(id) on delete set null;
alter table post add column if not exists deleted_by uuid references actor(id) on delete set null;
alter table comment add column if not exists deleted_by uuid references actor(id) on delete set null;
alter table conversation add column if not exists deleted_by uuid references actor(id) on delete set null;

/*
 * A deleted channel, to whoever could see it while it stood.
 *
 * A room's policies (`c_read`, `c_update`) read only a standing one, so a
 * deleted room is nobody's to find — which is right for every read and
 * wrong for the one that puts it back. This answers the same question
 * `can_see_conversation` asks, of a deleted room: in this workspace, on a
 * standing project the asker is on (or outside every project, and not
 * through a token held to some), and theirs to see — its people, or the
 * whole project when nobody was chosen. A room of chosen people stays
 * theirs while it is deleted too.
 *
 * `can()` decides whether they may restore it, on the server; this only
 * finds it, and `room_back` asks the same again before it writes.
 */
create or replace function deleted_room(p uuid)
returns table (project_id uuid, channel boolean, created_by uuid, deleted_by uuid, chosen boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select cv.project_id, cv.channel, cv.created_by, cv.deleted_by, cv.chosen
  from conversation cv
  where cv.id = p and cv.deleted_at is not null
    and cv.workspace_id = current_workspace()
    and exists (
      select 1 from membership mm
      where mm.workspace_id = cv.workspace_id and mm.actor_id = current_actor()
        and mm.joined_at is not null and mm.deleted_at is null
    )
    and (
      (cv.project_id is null and (select token_projects()) is null)
      or (in_project(cv.project_id)
          and exists (select 1 from project pr where pr.id = cv.project_id and pr.deleted_at is null))
    )
    and (
      exists (
        select 1 from conversation_member cm
        where cm.conversation_id = cv.id and cm.actor_id = current_actor()
          and cm.joined_at is not null and cm.deleted_at is null
      )
      or (cv.project_id is not null and not cv.chosen)
    )
$$;
revoke all on function deleted_room(uuid) from public;
grant execute on function deleted_room(uuid) to tracker_app;

/* Putting it back, for the asker `deleted_room` finds it for. */
create or replace function room_back(p uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from deleted_room(p)) then
    return false;
  end if;
  update conversation set deleted_at = null, deleted_by = null, updated_at = now()
  where id = p and deleted_at is not null;
  return found;
end $$;
revoke all on function room_back(uuid) from public;
grant execute on function room_back(uuid) to tracker_app;
