/*
 * A deleted file goes for good on a press.
 *
 * The application has no delete right on `file`: every delete in Docs is
 * soft, and the clear-out (`purge_deleted`, run by the worker) is what took
 * a row out thirty days later. "Delete forever" in a project's Recently
 * Deleted takes one row out now, the way the clear-out does — the same
 * `delete from file`, so the same triggers fire: its bytes queued for
 * storage (`file_bytes_go_with_it`, migration 101), its comments,
 * subscriptions and links (`file_takes_what_hangs_on_it`, migration 262),
 * and its versions and co-editing state by their foreign keys.
 *
 * Two functions, so that neither half is trusted alone. `can()` on the
 * server decides first — whoever deleted it, or whoever holds
 * `file.delete` there, never through a token nor by an agent. Then:
 *
 * - `purge_file(p)` runs as the caller (security invoker): it finds the row
 *   through the caller's own row policies — the file's read and update
 *   policies, the token bound, and whatever a later migration adds to them
 *   — and locks it. A row the caller could not see is not found, whatever
 *   copy of the policy anybody keeps elsewhere.
 * - `purge_file_row(p)` is the definer that deletes. It asks again what
 *   does not depend on the policies: the row is deleted, in the session's
 *   workspace, on a standing project, not through a token — and the
 *   restore rule itself: the caller deleted it, or holds `file.delete` on
 *   the project (the owner with a confirmed address, or `manage` or
 *   `task.delete` there, as `can()` reads them).
 *
 * A folder left from before folders went may still be named by rows that
 * were in it; they stay where they are, at the top level, rather than
 * holding the folder's row up — the clear-out's foreign-key refusal is
 * what kept such a folder forever.
 *
 * Edited in place before it shipped: the first version
 * was one definer that copied the read policy by hand and asked no rights.
 */
drop function if exists purge_file(uuid);

create or replace function purge_file_row(p uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
begin
  if (select token_projects()) is not null then
    return false;
  end if;
  select f.id into v_id
  from file f
  join project pr on pr.id = f.project_id and pr.deleted_at is null
  where f.id = p
    and f.deleted_at is not null
    and f.workspace_id = current_workspace()
    and (
      f.deleted_by = current_actor()
      or (role_in(pr.workspace_id) = 'owner' and auth_email_confirmed(current_actor()) is not false)
      or exists (
        select 1 from project_member pm
        where pm.project_id = pr.id and pm.actor_id = current_actor()
          and pm.deleted_at is null and pm.rights && array['manage', 'task.delete']
      )
    )
  for update of f;
  if v_id is null then
    return false;
  end if;
  update file set folder_id = null where folder_id = v_id and workspace_id = current_workspace();
  delete from file where id = v_id;
  return true;
end $$;
revoke all on function purge_file_row(uuid) from public;
grant execute on function purge_file_row(uuid) to tracker_app;

create or replace function purge_file(p uuid) returns boolean
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_id uuid;
begin
  select f.id into v_id from file f
  where f.id = p and f.deleted_at is not null and f.project_id is not null
  for update of f;
  if v_id is null then
    return false;
  end if;
  return purge_file_row(v_id);
end $$;
revoke all on function purge_file(uuid) from public;
grant execute on function purge_file(uuid) to tracker_app;
