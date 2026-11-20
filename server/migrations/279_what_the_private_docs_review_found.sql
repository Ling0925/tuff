/*
 * What the independent review of found.
 *
 * 1. A picture put into a draft was a project's upload like any other:
 *    listed in Docs with its signed thumbnail, told to the socket and the
 *    webhooks, and read through MCP — and a picture in a comment on the
 *    draft named the draft's id as where it was first put. A file whose
 *    place is a document (`origin_type = 'file'`) is now seen by whoever may
 *    see that document, in the read policy and in every definer function
 *    that reads files for somebody.
 * 2. After the clear-out took a draft for good, the feed's lines about it —
 *    and about its pictures — read as anybody's, because a file that is
 *    not there is kept from nobody. They go with it, and its pictures go to
 *    the bin.
 * 3. Who a document is for was the server's alone to hold: the policy let
 *    anybody who could see a document write its people and change its
 *    `audience`. Both ask the share right now (`may_share_file`), and a
 *    draft is never made again.
 * 4. Somebody taken off the project, or out of the workspace, kept their
 *    place on a document's people, and was let back in by being added
 *    again. Their places go when they do; a chosen person is somebody of
 *    the workspace now, as well as of the project.
 *
 * Changes no rows, except that people who already left lose places that
 * no longer let them in.
 */

/* ------------------------------------------------- who may share */

/*
 * The share right as the database can ask it — `file.share` in `can()`:
 * its author on the project, or somebody who may edit somebody else's
 * document there (`content.edit.said`, or a member where the workspace lets
 * members edit others' documents). `can()` asks more — never an agent,
 * never a token — and the server asks it first; this is the floor.
 */
create function may_share_file(p_author uuid, p_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_project is not null and in_project(p_project) and (
    p_author = current_actor()
    or may_edit_said(p_project)
    or exists (
      select 1 from project pr join workspace w on w.id = pr.workspace_id
      where pr.id = p_project and role_in(pr.workspace_id) = 'member'
        and coalesce(w.settings->>'edit_others_content', 'documents_too') = 'documents_too'
    )
  )
$$;
grant execute on function may_share_file(uuid, uuid) to tracker_app;

/* Whether somebody may be one of a document's people: of its workspace,
   and on its project or the owner. */
create function chosen_may_be(p_file uuid, p_actor uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from file f
    join membership m on m.workspace_id = f.workspace_id and m.actor_id = p_actor
      and m.deleted_at is null and m.joined_at is not null
    where f.id = p_file
      and (current_workspace() is null or f.workspace_id = current_workspace())
      and (m.role = 'owner' or exists (
        select 1 from project_member pm
        where pm.project_id = f.project_id and pm.actor_id = p_actor and pm.deleted_at is null))
  )
$$;
grant execute on function chosen_may_be(uuid, uuid) to tracker_app;

/* ------------------------------------------------- 278 */

/*
 * Whether this file is kept from the asker by who it is for — its own
 * answer, or the answer of the document it was put into. Bounded by the
 * session's workspace.
 */
create or replace function file_kept_from_me(p_file uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from file f
    left join file d on f.origin_type = 'file' and d.id = f.origin_id and d.workspace_id = f.workspace_id
    where f.id = p_file
      and (current_workspace() is null or f.workspace_id = current_workspace())
      and (
        (f.audience <> 'project' and f.author_id is distinct from current_actor()
         and not (f.audience = 'chosen' and chosen_for(f.id, f.workspace_id)))
        or (d.id is not null and d.audience <> 'project' and d.author_id is distinct from current_actor()
            and not (d.audience = 'chosen' and chosen_for(d.id, d.workspace_id)))
      )
  )
$$;

drop policy o_read on file;
create policy o_read on file for select using (
  (project_id is null or project_id in (select visible_projects()))
  and (conversation_id is null or conversation_id in (select visible_conversations()))
  and (audience = 'project' or author_id = current_actor()
       or (audience = 'chosen' and chosen_for(id, workspace_id)))
  /* A picture or a file put into a document is that document's to show. */
  and (origin_type is distinct from 'file' or not file_kept_from_me(origin_id))
);

drop policy o_update on file;
create policy o_update on file for update using (
  (project_id is null or project_id in (select visible_projects()))
  and (conversation_id is null or conversation_id in (select visible_conversations()))
  and (audience = 'project' or author_id = current_actor()
       or (audience = 'chosen' and chosen_for(id, workspace_id)))
  and (origin_type is distinct from 'file' or not file_kept_from_me(origin_id))
) with check (true);

/* Who a document is for changes only by somebody who may share it, and a
   document is never a draft again. A write with nobody asking — a
   migration, the clear-out — is the owner's. */
create function file_audience_is_the_sharers() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.audience is distinct from old.audience then
    if new.audience = 'author' then
      raise exception 'A document is not made a draft again.' using errcode = '42501';
    end if;
    if current_actor() is not null and not may_share_file(old.author_id, old.project_id) then
      raise exception 'Not yours to say who sees it.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke execute on function file_audience_is_the_sharers() from public;
create trigger file_audience_is_the_sharers before update of audience on file
  for each row execute function file_audience_is_the_sharers();

drop policy fr_write on file_reader;
create policy fr_write on file_reader for insert with check (
  is_member(workspace_id) and (current_workspace() is null or workspace_id = current_workspace())
  and exists (
    select 1 from file f
    where f.id = file_reader.file_id and f.workspace_id = file_reader.workspace_id
      and f.deleted_at is null and f.body is not null and f.storage_key is null and f.url is null
      and may_share_file(f.author_id, f.project_id)
  )
  and chosen_may_be(file_id, actor_id)
);
drop policy fr_delete on file_reader;
create policy fr_delete on file_reader for delete using (
  is_member(workspace_id) and (current_workspace() is null or workspace_id = current_workspace())
  and exists (
    select 1 from file f
    where f.id = file_reader.file_id and f.workspace_id = file_reader.workspace_id
      and may_share_file(f.author_id, f.project_id)
  )
);

/* ------------------------------------------------- leaving */

/* A place on a document's people goes with the person's place on its
   project, and with their place in the workspace: added back, they are
   chosen again or not, by somebody, on purpose. */
create function file_reader_goes_with_its_person() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'membership' then
    delete from file_reader where workspace_id = old.workspace_id and actor_id = old.actor_id;
  else
    delete from file_reader r using file f
    where r.workspace_id = old.workspace_id and r.actor_id = old.actor_id
      and f.id = r.file_id and f.project_id = old.project_id;
  end if;
  return null;
end $$;
revoke execute on function file_reader_goes_with_its_person() from public;
create trigger file_reader_goes_with_membership after update of deleted_at on membership
  for each row when (old.deleted_at is null and new.deleted_at is not null)
  execute function file_reader_goes_with_its_person();
create trigger file_reader_goes_with_membership_row after delete on membership
  for each row execute function file_reader_goes_with_its_person();
create trigger file_reader_goes_with_project_member after update of deleted_at on project_member
  for each row when (old.deleted_at is null and new.deleted_at is not null)
  execute function file_reader_goes_with_its_person();
create trigger file_reader_goes_with_project_member_row after delete on project_member
  for each row execute function file_reader_goes_with_its_person();

/* Those who already left. */
delete from file_reader r
where not exists (
  select 1 from file f
  join membership m on m.workspace_id = f.workspace_id and m.actor_id = r.actor_id
    and m.deleted_at is null and m.joined_at is not null
  where f.id = r.file_id
    and (m.role = 'owner' or exists (
      select 1 from project_member pm
      where pm.project_id = f.project_id and pm.actor_id = r.actor_id and pm.deleted_at is null))
);

/* ------------------------------------------------- the clear-out */

/*
 * A document nobody but its people saw, taken for good: its lines in the
 * feed go with it, and the pictures put into it go to the bin, their lines
 * with them — once it is gone nothing says whom they were kept from.
 */
create function file_kept_goes_whole() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.audience <> 'project' then
    delete from activity_event
    where workspace_id = old.workspace_id and object_type = 'file'
      and (object_id = old.id
           or object_id in (select x.id from file x where x.origin_type = 'file' and x.origin_id = old.id));
    update file set deleted_at = coalesce(deleted_at, now())
    where workspace_id = old.workspace_id and origin_type = 'file' and origin_id = old.id;
  end if;
  return old;
end $$;
revoke execute on function file_kept_goes_whole() from public;
create trigger file_kept_goes_whole after delete on file
  for each row execute function file_kept_goes_whole();

/* ------------------------------------------------- 278: may_read */

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
      /* As `o_read` on file has it since 279. */
      select exists (
        select 1 from file f
        where f.id = p_id and f.deleted_at is null
          and (f.project_id is null or f.project_id in (select visible_projects()))
          and (f.conversation_id is null or f.conversation_id in (select visible_conversations()))
          and (f.audience = 'project' or f.author_id = p_actor
               or (f.audience = 'chosen' and chosen_for(f.id, f.workspace_id)))
          and (f.origin_type is distinct from 'file' or not file_kept_from_me(f.origin_id))
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

/* ------------------------------------------------- 278: search_files */

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
    and (f.origin_type is distinct from 'file' or not file_kept_from_me(f.origin_id))
    and f.deleted_at is null
    and (f.name ilike q.l or (length(p_q) >= 3 and f.said ilike q.l))
    and (p_project is null or f.project_id = p_project)
  order by f.name ilike q.l desc, f.created_at desc
  limit 20
$$;

/* ------------------------------------------------- 278: a shared document's pictures

   Its own pictures, and any other the project has: never one put into a
   document the project does not have. */
create or replace function public_document_files(p_token text)
returns table (id uuid, storage_key text, display_key text, content_type text)
language sql stable security definer set search_path = public as $$
  select x.id, x.storage_key, x.display_key, x.content_type
  from public_document(p_token) d
  join file src on src.id = d.id
  join file x on x.workspace_id = src.workspace_id and x.deleted_at is null and x.storage_key is not null
    and x.project_id = src.project_id and x.conversation_id is null and x.audience = 'project'
    and (x.origin_type is distinct from 'file' or x.origin_id = src.id
         or exists (select 1 from file o where o.id = x.origin_id and o.audience = 'project'))
  where x.id::text in (select jsonb_path_query(d.body, 'strict $.**.fileId') #>> '{}')
$$;

/* ------------------------------------------------- 278: slack_preview */

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
    and (f.origin_type is distinct from 'file'
         or exists (select 1 from file o where o.id = f.origin_id and o.audience = 'project'))
    and (f.storage_key is null or f.uploaded_at is not null)
    and (f.body is not null or f.url is not null or f.storage_key is not null)
  join actor a on a.id = f.author_id
  where p_kind = 'file'
$$;
