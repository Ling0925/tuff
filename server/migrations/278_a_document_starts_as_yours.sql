/*
 * A written document starts as its author's, and is published to the
 * project or to chosen people.
 *
 * `file.audience` says who sees a file: `author` (a draft), `chosen` (the
 * author and the people in `file_reader`) or `project`. One column rather
 * than two flags, for the reason `conversation.chosen` is one (migration
 * 240): chosen with nobody left on the list is its author's, not
 * everybody's.
 *
 * The read policy holds it, and every definer function that reads a file
 * for somebody without the policy is told the same rule; each is otherwise
 * the text of the migration named over it.
 *
 * Changes no rows: the column comes with `project` as its default, which is
 * what every file there is was until now. A draft is made by the server,
 * for a document a person makes in the product.
 */

alter table file add column audience text not null default 'project';
/* Added NOT VALID and validated in the same breath. The runner applies the
   whole file in one transaction, so the lock adding it takes is held to
   the end either way and this saves nothing here; it is the form that
   would, split into two migrations, on a table too big to hold. Named as
   Postgres names an inline check, so a database that took the first text
   of this migration ends the same. */
alter table file add constraint file_audience_check
  check (audience in ('author', 'chosen', 'project')) not valid;
alter table file validate constraint file_audience_check;

/* Only a written document is ever anybody's but the project's: an upload, a
   link and a folder are put in Docs for the project to have. */
alter table file add constraint file_audience_is_a_documents
  check (audience = 'project' or (body is not null and storage_key is null and url is null)) not valid;
alter table file validate constraint file_audience_is_a_documents;

create table file_reader (
  workspace_id uuid not null references workspace(id),
  file_id uuid not null references file(id) on delete cascade,
  actor_id uuid not null references actor(id),
  created_at timestamptz not null default now(),
  primary key (workspace_id, file_id, actor_id)
);
/* An account's clear-out finds its rows by the person. */
create index file_reader_by_actor on file_reader (workspace_id, actor_id);

/*
 * Whether the asker was chosen for this file. A definer, because the file's
 * policy asks it and `file_reader`'s own policy asks about the file: two
 * policies asking each other is a recursion Postgres refuses at the first
 * query. Read by the key, workspace first.
 */
create function chosen_for(p_file uuid, p_workspace uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from file_reader r
    where r.workspace_id = p_workspace and r.file_id = p_file and r.actor_id = current_actor()
  )
$$;
grant execute on function chosen_for(uuid, uuid) to tracker_app;

/*
 * Whether this file exists and is kept from the asker by who it is for —
 * its project and its room are asked by the policies that ask them. For the
 * feed, whose lines about a file purged since must still read as they did.
 */
create function file_kept_from_me(p_file uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from file f
    where f.id = p_file and f.audience <> 'project'
      and f.author_id is distinct from current_actor()
      and not (f.audience = 'chosen' and chosen_for(f.id, f.workspace_id))
  )
$$;
grant execute on function file_kept_from_me(uuid) to tracker_app;

/* ------------------------------------------------- 137 */

drop policy o_read on file;
create policy o_read on file for select using (
  (project_id is null or project_id in (select visible_projects()))
  and (conversation_id is null or conversation_id in (select visible_conversations()))
  and (audience = 'project' or author_id = current_actor()
       or (audience = 'chosen' and chosen_for(id, workspace_id)))
);

drop policy o_update on file;
create policy o_update on file for update using (
  (project_id is null or project_id in (select visible_projects()))
  and (conversation_id is null or conversation_id in (select visible_conversations()))
  and (audience = 'project' or author_id = current_actor()
       or (audience = 'chosen' and chosen_for(id, workspace_id)))
) with check (true);

/*
 * Who a file is for: read by whoever may read the file, written by whoever
 * may read it in the workspace they are in. Whether they may change who it
 * is for at all is `file.share`, asked in `can()` before the write.
 */
alter table file_reader enable row level security;
create policy fr_read on file_reader for select using (
  is_member(workspace_id) and (current_workspace() is null or workspace_id = current_workspace())
  and exists (select 1 from file f where f.id = file_reader.file_id and f.workspace_id = file_reader.workspace_id)
);
create policy fr_write on file_reader for insert with check (
  is_member(workspace_id) and (current_workspace() is null or workspace_id = current_workspace())
  and exists (
    select 1 from file f
    where f.id = file_reader.file_id and f.workspace_id = file_reader.workspace_id
      and f.deleted_at is null and f.body is not null and f.storage_key is null and f.url is null
  )
);
create policy fr_delete on file_reader for delete using (
  is_member(workspace_id) and (current_workspace() is null or workspace_id = current_workspace())
  and exists (select 1 from file f where f.id = file_reader.file_id and f.workspace_id = file_reader.workspace_id)
);
grant select, insert, delete on file_reader to tracker_app;

/* ------------------------------------------------- 241 */

drop policy ae_read on activity_event;
create policy ae_read on activity_event for select using (
  workspace_id in (select staff_workspaces())
  and (
    (project_id is not null and project_id in (select visible_projects()))
    or (project_id is null and object_type is distinct from 'conversation'
        and (actor_id = current_actor() or workspace_id in (select owned_workspaces())))
    or (project_id is null and object_type = 'conversation' and object_id in (select visible_conversations()))
  )
  /* Nothing about a document somebody was not given — not that it was
     made, written in or shared. */
  and (object_type is distinct from 'file' or object_id is null or not file_kept_from_me(object_id))
);

/* ------------------------------------------------- 188 */

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
      /* As `o_read` on file has it since 278: the project, the room it was
         sent in, and who it is for. */
      select exists (
        select 1 from file f
        where f.id = p_id and f.deleted_at is null
          and (f.project_id is null or f.project_id in (select visible_projects()))
          and (f.conversation_id is null or f.conversation_id in (select visible_conversations()))
          and (f.audience = 'project' or f.author_id = p_actor
               or (f.audience = 'chosen' and chosen_for(f.id, f.workspace_id)))
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

/* ------------------------------------------------- 137 */

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
    and f.deleted_at is null
    and (f.name ilike q.l or (length(p_q) >= 3 and f.said ilike q.l))
    and (p_project is null or f.project_id = p_project)
  order by f.name ilike q.l desc, f.created_at desc
  limit 20
$$;

/* ------------------------------------------------- 134, 137

   On the web only while it is the project's: a draft or a document of
   chosen people is read by nobody holding a link. */
create or replace function public_document(p_token text)
returns table (id uuid, name text, body jsonb, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select f.id, f.name, f.body, f.updated_at
  from file f
  left join project p on p.id = f.project_id
  where f.public_token = p_token and f.public_token is not null
    and f.deleted_at is null and f.body is not null
    and f.storage_key is null and f.url is null
    and f.audience = 'project'
    and (p.id is null or p.deleted_at is null)
$$;

create or replace function public_document_files(p_token text)
returns table (id uuid, storage_key text, display_key text, content_type text)
language sql stable security definer set search_path = public as $$
  select x.id, x.storage_key, x.display_key, x.content_type
  from public_document(p_token) d
  join file src on src.id = d.id
  join file x on x.workspace_id = src.workspace_id and x.deleted_at is null and x.storage_key is not null
    and x.project_id = src.project_id and x.conversation_id is null and x.audience = 'project'
  where x.id::text in (select jsonb_path_query(d.body, 'strict $.**.fileId') #>> '{}')
$$;

/* ------------------------------------------------- 165

   A Tuff link pasted in a project's Slack channel unfurls only a file the
   project has. */
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
    and (f.storage_key is null or f.uploaded_at is not null)
    and (f.body is not null or f.url is not null or f.storage_key is not null)
  join actor a on a.id = f.author_id
  where p_kind = 'file'
$$;
