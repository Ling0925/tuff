/*
 * What the fifth review of found.
 *
 * Who sees a picture was keyed on `origin_type = 'file'` / `origin_id`,
 * which production already has on rows that never came from `?into`: the
 * claim that named a file's first place from a comment on a document ran
 * for years, and migration 089 filled it in from comments. At deploy those
 * files would have become their uploaders' alone, and a document narrowed
 * and taken for good would have taken other people's uploads with it.
 *
 * So a file put into a document says so in a column of its own,
 * `file.held_by`, written only by an upload sent `into` a document, and
 * every rule of who sees a file, what is told and what goes with a
 * document reads that column alone. `origin_type` / `origin_id` are back to
 * being a label — where a file was first put — with no say in who sees it.
 * A held file whose document is not there is its uploader's alone; taking
 * a document of the project for good lets its files go to the project.
 *
 * And the feed: a line written while its file was kept from the project is
 * its own actor's for good (`activity_event.kept`), so publishing a document
 * does not show what was done in it while it was a draft.
 *
 * Changes no rows. The indexes are made inside the migration's transaction,
 * which `create index concurrently` cannot be: the runner applies every
 * file in one (`server/src/db/migrate.ts`). Building each reads the whole
 * of `file` once, holding writes to it for that long; with no row holding
 * anything yet, each writes nothing.
 */

alter table file add column held_by uuid;
alter table activity_event add column kept boolean not null default false;

drop index if exists file_by_origin_document;
drop index if exists file_put_into_by_project;
create index file_held_by on file (held_by) where held_by is not null;
create index file_held_by_project on file (project_id) where held_by is not null;

/* ------------------------------------------------- one rule for a held file */

/* Whether the document a file is held by is the asker's to see: a written
   document of the session's workspace, on a project of theirs, for them by
   who it is for. One answer, the set's, for every rule that asks. */
create or replace function file_origin_open(p_doc uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from documents_open_to_me() x where x = p_doc)
$$;

create or replace function file_apart(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select f.audience <> 'project'
        or (f.held_by is not null and not exists (
              select 1 from file d
              where d.id = f.held_by and d.workspace_id = f.workspace_id and d.audience = 'project'
                and d.body is not null and d.storage_key is null and d.url is null))
        or coalesce((select cv.chosen or cv.project_id is null from conversation cv where cv.id = f.conversation_id), false)
    from file f
    where f.id = p and f.workspace_id = current_workspace()
  ), false)
$$;

create or replace function files_kept_from_me() returns setof uuid
language sql stable security definer set search_path = public as $$
  select d.id from file d
  where d.workspace_id = current_workspace()
    and d.project_id = any (array(select visible_projects()))
    and d.audience <> 'project'
    and d.author_id is distinct from current_actor()
    and not (d.audience = 'chosen' and exists (
      select 1 from file_reader r
      where r.workspace_id = d.workspace_id and r.file_id = d.id and r.actor_id = current_actor()))
  union all
  select x.id from file x
  where x.workspace_id = current_workspace()
    and x.project_id = any (array(select visible_projects()))
    and x.held_by is not null
    and x.author_id is distinct from current_actor()
    and not (x.held_by in (select documents_open_to_me()))
$$;

drop policy o_read on file;
create policy o_read on file for select using (
  (project_id is null or project_id in (select visible_projects()))
  and (conversation_id is null or conversation_id in (select visible_conversations()))
  and (audience = 'project' or author_id = current_actor()
       or (audience = 'chosen' and chosen_for(id, workspace_id)))
  and (held_by is null or author_id = current_actor() or held_by in (select documents_open_to_me()))
);

drop policy o_update on file;
create policy o_update on file for update using (
  (project_id is null or project_id in (select visible_projects()))
  and (conversation_id is null or conversation_id in (select visible_conversations()))
  and (audience = 'project' or author_id = current_actor()
       or (audience = 'chosen' and chosen_for(id, workspace_id)))
  and (held_by is null or author_id = current_actor() or held_by in (select documents_open_to_me()))
) with check (true);

/* A line written while its file was kept is its own actor's for good. */
drop policy ae_read on activity_event;
create policy ae_read on activity_event for select using (
  workspace_id in (select staff_workspaces())
  and (
    (project_id is not null and project_id in (select visible_projects()))
    or (project_id is null and object_type is distinct from 'conversation'
        and (actor_id = current_actor() or workspace_id in (select owned_workspaces())))
    or (project_id is null and object_type = 'conversation' and object_id in (select visible_conversations()))
  )
  and (not kept or actor_id = current_actor())
  and (object_type is distinct from 'file' or object_id is null
       or not (object_id in (select files_kept_from_me())))
);

/* ------------------------------------------------- the clear-out */

create or replace function file_kept_goes_whole() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.audience <> 'project' then
    delete from activity_event
    where workspace_id = old.workspace_id and object_type = 'file'
      and (object_id = old.id
           or object_id in (select x.id from file x where x.held_by = old.id and x.workspace_id = old.workspace_id));
    delete from file where held_by = old.id and workspace_id = old.workspace_id;
  else
    update file set held_by = null where held_by = old.id and workspace_id = old.workspace_id;
  end if;
  return old;
end $$;

/* ------------------------------------------------- 282: may_read */

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
      /* As `o_read` on file has it since 285. */
      select exists (
        select 1 from file f
        where f.id = p_id and f.deleted_at is null
          and (f.project_id is null or f.project_id in (select visible_projects()))
          and (f.conversation_id is null or f.conversation_id in (select visible_conversations()))
          and (f.audience = 'project' or f.author_id = p_actor
               or (f.audience = 'chosen' and chosen_for(f.id, f.workspace_id)))
          and (f.held_by is null or f.author_id = p_actor or file_origin_open(f.held_by))
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

/* ------------------------------------------------- 282: search_files */

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
    and (f.held_by is null or f.author_id = current_actor() or f.held_by in (select documents_open_to_me()))
    and f.deleted_at is null
    and (f.name ilike q.l or (length(p_q) >= 3 and f.said ilike q.l))
    and (p_project is null or f.project_id = p_project)
  order by f.name ilike q.l desc, f.created_at desc
  limit 20
$$;

/* ------------------------------------------------- 279: a shared document's pictures */

create or replace function public_document_files(p_token text)
returns table (id uuid, storage_key text, display_key text, content_type text)
language sql stable security definer set search_path = public as $$
  select x.id, x.storage_key, x.display_key, x.content_type
  from public_document(p_token) d
  join file src on src.id = d.id
  join file x on x.workspace_id = src.workspace_id and x.deleted_at is null and x.storage_key is not null
    and x.project_id = src.project_id and x.conversation_id is null and x.audience = 'project'
    and (x.held_by is null or x.held_by = src.id
         or exists (select 1 from file o where o.id = x.held_by and o.audience = 'project'))
  where x.id::text in (select jsonb_path_query(d.body, 'strict $.**.fileId') #>> '{}')
$$;

/* ------------------------------------------------- 279: slack_preview */

create or replace function slack_preview(p_unfurl uuid, p_ws text, p_project text, p_kind text, p_number int)
returns table (
  kind text, workspace_slug text, project_slug text, project_name text, project_key text,
  number int, title text, list_name text, list_icon text, done boolean, people text, due_on date,
  at timestamptz, said text, file_kind text, content_type text, size_bytes bigint, address text
)
language sql stable security definer set search_path = public as $$
  with here as (
    select p.id, p.name, p.key, p.slug::text as pslug, w.slug::text as wslug, p.description
    from slack_unfurl u
    join slack_connection sc on sc.id = u.connection_id and sc.deleted_at is null and sc.broken_at is null
    join slack_link sl on sl.connection_id = sc.id and sl.workspace_id = sc.workspace_id
      and sl.channel_id = u.channel_id and sl.deleted_at is null and sl.stopped_at is null
    join project p on p.id = sl.project_id and p.workspace_id = sc.workspace_id and p.deleted_at is null
    join workspace w on w.id = sc.workspace_id and w.deleted_at is null
    where u.id = p_unfurl
      and lower(w.slug::text) = lower(p_ws) and lower(p.slug::text) = lower(p_project)
  )
  select 'project', h.wslug, h.pslug, h.name, h.key, null::int, h.name, null, null, false, null, null::date,
         null::timestamptz, h.description, null, null, null::bigint, null
  from here h where p_kind = 'project'
  union all
  select 'task', h.wslug, h.pslug, h.name, h.key, t.number, t.title, tl.name, tl.icon, t.completed_at is not null,
         (select string_agg(a.name, ', ' order by a.name) from actor a where a.id = any(t.assignee_ids) or a.id = t.assignee_id),
         t.due_on, null, t.said, null, null, null, null
  from here h
  join task t on t.project_id = h.id and t.number = p_number and t.parent_id is null and t.deleted_at is null
  left join task_list tl on tl.id = t.list_id and tl.deleted_at is null
  where p_kind = 'task'
  union all
  select 'post', h.wslug, h.pslug, h.name, h.key, po.number, po.title, null, null, false, a.name, null,
         po.published_at, po.said, null, null, null, null
  from here h
  join post po on po.project_id = h.id and po.number = p_number and po.deleted_at is null
    and po.published_at is not null and po.published_at <= now()
  join actor a on a.id = po.author_id
  where p_kind = 'post'
  union all
  select 'file', h.wslug, h.pslug, h.name, h.key, f.number, f.name, null, null, false, a.name, null,
         coalesce(f.updated_at, f.created_at), f.said,
         case when f.url is not null then 'link' when f.storage_key is not null then 'upload' else 'doc' end,
         f.content_type, f.size_bytes,
         substring(f.url from '^[a-zA-Z][a-zA-Z0-9+.-]*://([^/?#:@]+)')
  from here h
  join file f on f.project_id = h.id and f.number = p_number and f.deleted_at is null and f.conversation_id is null
    and f.audience = 'project'
    and (f.held_by is null or exists (select 1 from file o where o.id = f.held_by and o.audience = 'project'))
    and (f.storage_key is null or f.uploaded_at is not null)
    and (f.body is not null or f.url is not null or f.storage_key is not null)
  join actor a on a.id = f.author_id
  where p_kind = 'file'
$$;
