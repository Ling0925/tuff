/*
 * What the seventh review of found.
 *
 * 1. With no workspace on the session the set of documents kept from the
 *    asker was empty, so a draft's held picture read as nobody's to keep. A
 *    held file is read with a workspace on the session now, or by its
 *    uploader, and not otherwise.
 * 2. `held_by` could be cleared by any write the policy let through, which
 *    shows the file to the whole project, and an upload could name a draft
 *    its writer could not read and learn from the refusal that it exists.
 *    Clearing is the clear-out's alone (inside its trigger), and the
 *    document an upload names must be one its writer may read.
 * 3. Narrowing a document marked what the project had already read of it
 *    kept, so publishing it again hid that history for good. A line is kept
 *    only when it is written while its file is kept; `keep_file_lines` goes.
 * 4. Erasing a workspace ends every membership at the workspace's own
 *    moment, and took everybody's places on documents with it, so a
 *    workspace an operator put back came back with its documents' people
 *    gone. An erase leaves them; a person leaving still takes theirs.
 *
 * Changes no rows.
 */

/* ------------------------------------------------- 1 */

drop policy o_read on file;
create policy o_read on file for select using (
  (project_id is null or project_id in (select visible_projects()))
  and (conversation_id is null or conversation_id in (select visible_conversations()))
  and (audience = 'project' or author_id = current_actor()
       or (audience = 'chosen' and chosen_for(id, workspace_id)))
  and (held_by is null or author_id = current_actor()
       or (current_workspace() is not null and not (held_by in (select documents_kept_from_me()))))
);

drop policy o_update on file;
create policy o_update on file for update using (
  (project_id is null or project_id in (select visible_projects()))
  and (conversation_id is null or conversation_id in (select visible_conversations()))
  and (audience = 'project' or author_id = current_actor()
       or (audience = 'chosen' and chosen_for(id, workspace_id)))
  and (held_by is null or author_id = current_actor()
       or (current_workspace() is not null and not (held_by in (select documents_kept_from_me()))))
) with check (true);

create or replace function search_files(p_q text, p_project uuid)
returns table (id uuid, number int, project_id uuid, title text, created_at timestamptz, snippet text)
language sql stable security definer set search_path = public as $$
  with q as (select '%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%' as l)
  select f.id, f.number, f.project_id, f.name, f.created_at,
         case when f.name ilike q.l then null
              else substr(f.said, greatest(1, strpos(lower(f.said), lower(p_q)) - 32), 96) end
  from file f, q
  where f.workspace_id = current_workspace()
    and (f.project_id is null or f.project_id in (select visible_projects()))
    and (f.conversation_id is null or f.conversation_id in (select visible_conversations()))
    and (f.audience = 'project' or f.author_id = current_actor()
         or (f.audience = 'chosen' and chosen_for(f.id, f.workspace_id)))
    and (f.held_by is null or f.author_id = current_actor()
         or (current_workspace() is not null and not (f.held_by in (select documents_kept_from_me()))))
    and f.deleted_at is null
    and (f.name ilike q.l or (length(p_q) >= 3 and f.said ilike q.l))
    and (p_project is null or f.project_id = p_project)
  order by f.name ilike q.l desc, f.created_at desc
  limit 20
$$;

/* ------------------------------------------------- 2 */

create or replace function held_by_holds() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.held_by is not null then
      perform 1 from file d
      where d.id = new.held_by and d.workspace_id = new.workspace_id
        and d.project_id is not distinct from new.project_id and new.project_id is not null
        and d.deleted_at is null and d.body is not null and d.storage_key is null and d.url is null
        /* One its writer may read: nothing is learnt from naming one that is
           not. A write with nobody asking — a migration, the load table —
           is the owner's. */
        and (current_actor() is null or d.audience = 'project' or d.author_id = current_actor()
             or (d.audience = 'chosen' and exists (
               select 1 from file_reader r
               where r.workspace_id = d.workspace_id and r.file_id = d.id and r.actor_id = current_actor())))
      for share;
      if not found then
        raise exception 'No such document to hold it.' using errcode = 'P0002';
      end if;
    end if;
  elsif new.held_by is distinct from old.held_by then
    /* Only cleared, and only by the clear-out letting a document of the
       project go (`file_kept_goes_whole`, a trigger itself). */
    if new.held_by is not null or pg_trigger_depth() < 2 then
      raise exception 'A file is held only when it is sent into a document.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

/* ------------------------------------------------- 3 */

drop function if exists keep_file_lines(uuid);

/* ------------------------------------------------- 4 */

create or replace function file_reader_goes_with_its_person() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  /* An erase ends every membership at the workspace's own moment, and an
     operator who puts the workspace back puts those back: the places on
     documents stay for them. */
  if tg_op = 'UPDATE' and exists (
    select 1 from workspace w
    where w.id = new.workspace_id and w.deleted_at is not null and w.deleted_at = new.deleted_at) then
    return null;
  end if;
  if tg_table_name = 'membership' then
    delete from file_reader where workspace_id = old.workspace_id and actor_id = old.actor_id;
  else
    delete from file_reader r using file f
    where r.workspace_id = old.workspace_id and r.actor_id = old.actor_id
      and f.id = r.file_id and f.project_id = old.project_id;
  end if;
  return null;
end $$;
