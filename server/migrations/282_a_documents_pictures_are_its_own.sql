/*
 * What the third review of found.
 * Each round the picture model
 * grew a hole, so this one takes machinery away where it can.
 *
 * 1. Only an upload sent `into` a document makes the document its place.
 *    The late claim is gone (`claimFiles`), and with it the column it
 *    needed: `file.named_elsewhere`.
 * 2. A file whose place is a document that is not there any more was read
 *    as nobody's to keep, so the whole project saw it. It is seen now only
 *    by whoever uploaded it (`file_origin_open`), and the clear-out of a
 *    kept document takes every file still put into it, for good; one of a
 *    document the project had goes back to being the project's.
 * 3. Which documents a chip names without their title is asked here,
 *    whoever writes (`kept_documents`).
 * 4. The reads by a file's place and by a person's places are indexed.
 *
 * Changes no rows.
 */

alter table file drop column named_elsewhere;

create index file_by_origin_document on file (origin_id) where origin_type = 'file';
create index file_reader_by_file on file_reader (file_id);
create index file_reader_by_person on file_reader (actor_id);

/* ------------------------------------------------- who may see a document's file */

/* Whether the document a file was put into is the asker's to see, by who
   it is for. A document not there — or of another workspace — is nobody's:
   the file is then its uploader's alone (the policy asks that first). */
create function file_origin_open(p_doc uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from file d
    where d.id = p_doc
      and (current_workspace() is null or d.workspace_id = current_workspace())
      and (d.audience = 'project' or d.author_id = current_actor()
           or (d.audience = 'chosen' and chosen_for(d.id, d.workspace_id)))
  )
$$;
grant execute on function file_origin_open(uuid) to tracker_app;

/* Of these documents, the ones the project does not have, in the asker's
   workspace — what a chip names without its title, whoever writes it. */
create function kept_documents(p_ids uuid[]) returns setof uuid
language sql stable security definer set search_path = public as $$
  select d.id from file d
  where d.id = any(p_ids) and d.workspace_id = current_workspace() and d.audience <> 'project'
$$;
grant execute on function kept_documents(uuid[]) to tracker_app;

drop policy o_read on file;
create policy o_read on file for select using (
  (project_id is null or project_id in (select visible_projects()))
  and (conversation_id is null or conversation_id in (select visible_conversations()))
  and (audience = 'project' or author_id = current_actor()
       or (audience = 'chosen' and chosen_for(id, workspace_id)))
  and (origin_type is distinct from 'file' or author_id = current_actor() or file_origin_open(origin_id))
);

drop policy o_update on file;
create policy o_update on file for update using (
  (project_id is null or project_id in (select visible_projects()))
  and (conversation_id is null or conversation_id in (select visible_conversations()))
  and (audience = 'project' or author_id = current_actor()
       or (audience = 'chosen' and chosen_for(id, workspace_id)))
  and (origin_type is distinct from 'file' or author_id = current_actor() or file_origin_open(origin_id))
) with check (true);

/* ------------------------------------------------- the clear-out */

/*
 * A document taken for good takes what was put into it. Kept from the
 * project, every file still put into it goes for good with its lines in the
 * feed — any naming of it where the whole project reads would already have
 * let it go. The project's, they go back to being the project's.
 */
create or replace function file_kept_goes_whole() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.audience <> 'project' then
    delete from activity_event
    where workspace_id = old.workspace_id and object_type = 'file'
      and (object_id = old.id
           or object_id in (select x.id from file x where x.origin_type = 'file' and x.origin_id = old.id));
    delete from file where origin_type = 'file' and origin_id = old.id;
  else
    update file set origin_type = null, origin_id = null where origin_type = 'file' and origin_id = old.id;
  end if;
  return old;
end $$;

/* ------------------------------------------------- 279: may_read */

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
      /* As `o_read` on file has it since 282. */
      select exists (
        select 1 from file f
        where f.id = p_id and f.deleted_at is null
          and (f.project_id is null or f.project_id in (select visible_projects()))
          and (f.conversation_id is null or f.conversation_id in (select visible_conversations()))
          and (f.audience = 'project' or f.author_id = p_actor
               or (f.audience = 'chosen' and chosen_for(f.id, f.workspace_id)))
          and (f.origin_type is distinct from 'file' or f.author_id = p_actor or file_origin_open(f.origin_id))
      ) into ok;
    end if;
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

/* ------------------------------------------------- 279: search_files */

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
    and (f.origin_type is distinct from 'file' or f.author_id = current_actor() or file_origin_open(f.origin_id))
    and f.deleted_at is null
    and (f.name ilike q.l or (length(p_q) >= 3 and f.said ilike q.l))
    and (p_project is null or f.project_id = p_project)
  order by f.name ilike q.l desc, f.created_at desc
  limit 20
$$;
