/*
 * What the sixth review of found
 * and "Pictures and files put into a document".
 *
 * 1. Taking a kept document for good read the whole feed to find its lines
 *    and its files' (`object_id = … or object_id in (…)`): two hundred
 *    milliseconds a document at a million lines. One array, read through
 *    `activity_by_object`.
 * 2. A held file asked for the set of every document the asker may see, in
 *    every project of theirs, to answer for one row (`documents_open_to_me`):
 *    thirty milliseconds for one signed link with eleven thousand documents.
 *    It asks for its own document now, by its key (`file_held_open`). The
 *    feed asked for every file kept from the asker (`files_kept_from_me`) on
 *    every page that had a line about a file: a line written while its file
 *    was kept says so (`kept`, 285), and only such a line asks about its
 *    file — readers of it, while it is still apart from the project. A
 *    document narrowed marks its lines and its files' kept as it goes
 *    (`keep_file_lines`). The sets, and 278's `file_kept_from_me`, go.
 * 3. `held_by` is written once, by an upload sent `into` a document of the
 *    same workspace and project that is there — checked with the document
 *    locked, so one taken for good at the same moment refuses the upload —
 *    and only ever cleared after that.
 * 4. Being chosen for a document is its own reason for a note, `shared`:
 *    the apps say a reason they do not know as "new activity".
 *
 * Changes no rows.
 */

alter type notify_reason add value if not exists 'shared';

/* ------------------------------------------------- one held file, its own document */

/* Whether the document holding a file is the asker's to see by who it is
   for — its own row, by its key, in the session's workspace. A document
   not there is nobody's. Its project is the file's (`held_by_holds`), which
   the file's own policy has asked already. */
create function file_held_open(p_doc uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from file d
    where d.id = p_doc and d.workspace_id = current_workspace()
      and (d.audience = 'project' or d.author_id = current_actor()
           or (d.audience = 'chosen' and exists (
             select 1 from file_reader r
             where r.workspace_id = d.workspace_id and r.file_id = d.id and r.actor_id = current_actor())))
  )
$$;
grant execute on function file_held_open(uuid) to tracker_app;

drop policy o_read on file;
create policy o_read on file for select using (
  (project_id is null or project_id in (select visible_projects()))
  and (conversation_id is null or conversation_id in (select visible_conversations()))
  and (audience = 'project' or author_id = current_actor()
       or (audience = 'chosen' and chosen_for(id, workspace_id)))
  and (held_by is null or author_id = current_actor() or file_held_open(held_by))
);

drop policy o_update on file;
create policy o_update on file for update using (
  (project_id is null or project_id in (select visible_projects()))
  and (conversation_id is null or conversation_id in (select visible_conversations()))
  and (audience = 'project' or author_id = current_actor()
       or (audience = 'chosen' and chosen_for(id, workspace_id)))
  and (held_by is null or author_id = current_actor() or file_held_open(held_by))
) with check (true);

/*
 * A line written while its file was kept is its actor's — and, while the
 * file is still apart from the project, its readers': the people of a
 * document, the people of a room. Once the file is the project's, its
 * kept lines are their actor's alone, so publishing shows no history.
 * Only a kept line asks, by the file's key, under the file's own policy.
 */
drop policy ae_read on activity_event;
create policy ae_read on activity_event for select using (
  workspace_id in (select staff_workspaces())
  and (
    (project_id is not null and project_id in (select visible_projects()))
    or (project_id is null and object_type is distinct from 'conversation'
        and (actor_id = current_actor() or workspace_id in (select owned_workspaces())))
    or (project_id is null and object_type = 'conversation' and object_id in (select visible_conversations()))
  )
  and (not kept or actor_id = current_actor() or (object_type = 'file' and exists (
    select 1 from file f
    where f.id = activity_event.object_id
      and (f.audience <> 'project' or f.conversation_id is not null
           or (f.held_by is not null and not exists (
                 select 1 from file d where d.id = f.held_by and d.audience = 'project'))))))
);

drop function if exists files_kept_from_me();
drop function if exists file_kept_from_me(uuid);

/* A document taken from the project, or from some of its people: what the
   feed says of it and of the files it holds so far is kept from here on.
   Only by somebody who may share it. */
create function keep_file_lines(p_doc uuid) returns void
language sql volatile security definer set search_path = public as $$
  update activity_event e set kept = true
  where e.workspace_id = current_workspace() and e.object_type = 'file' and not e.kept
    and e.object_id = any (array(
      select d.id from file d
      where d.id = p_doc and d.workspace_id = current_workspace() and may_share_file(d.author_id, d.project_id)
      union all
      select x.id from file x
      join file d on d.id = x.held_by
      where x.held_by = p_doc and x.workspace_id = current_workspace() and may_share_file(d.author_id, d.project_id)))
$$;
grant execute on function keep_file_lines(uuid) to tracker_app;

/* ------------------------------------------------- 285: may_read, search */

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
      /* As `o_read` on file has it since 286. */
      select exists (
        select 1 from file f
        where f.id = p_id and f.deleted_at is null
          and (f.project_id is null or f.project_id in (select visible_projects()))
          and (f.conversation_id is null or f.conversation_id in (select visible_conversations()))
          and (f.audience = 'project' or f.author_id = p_actor
               or (f.audience = 'chosen' and chosen_for(f.id, f.workspace_id)))
          and (f.held_by is null or f.author_id = p_actor or file_held_open(f.held_by))
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
    and (f.held_by is null or f.author_id = current_actor() or file_held_open(f.held_by))
    and f.deleted_at is null
    and (f.name ilike q.l or (length(p_q) >= 3 and f.said ilike q.l))
    and (p_project is null or f.project_id = p_project)
  order by f.name ilike q.l desc, f.created_at desc
  limit 20
$$;

drop function if exists file_origin_open(uuid);
drop function if exists documents_open_to_me();

/* ------------------------------------------------- the clear-out, through an index */

create or replace function file_kept_goes_whole() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.audience <> 'project' then
    delete from activity_event
    where workspace_id = old.workspace_id and object_type = 'file'
      and object_id = any (array(
        select old.id
        union all
        select x.id from file x where x.held_by = old.id and x.workspace_id = old.workspace_id));
    delete from file where held_by = old.id and workspace_id = old.workspace_id;
  else
    update file set held_by = null where held_by = old.id and workspace_id = old.workspace_id;
  end if;
  return old;
end $$;

/* ------------------------------------------------- held_by, written once */

/*
 * A file is held only from its first moment, by a written document of its
 * own workspace and project that is there — read with the document locked,
 * so a document taken for good at the same moment refuses the upload — and
 * after that `held_by` may only be cleared (a document of the project taken
 * for good lets its files go).
 */
create function held_by_holds() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.held_by is not null then
      perform 1 from file d
      where d.id = new.held_by and d.workspace_id = new.workspace_id
        and d.project_id is not distinct from new.project_id and new.project_id is not null
        and d.deleted_at is null and d.body is not null and d.storage_key is null and d.url is null
      for share;
      if not found then
        raise exception 'No such document to hold it.' using errcode = 'P0002';
      end if;
    end if;
  elsif new.held_by is distinct from old.held_by and new.held_by is not null then
    raise exception 'A file is held only when it is sent into a document.' using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function held_by_holds() from public;
create trigger held_by_holds before insert or update of held_by on file
  for each row execute function held_by_holds();
