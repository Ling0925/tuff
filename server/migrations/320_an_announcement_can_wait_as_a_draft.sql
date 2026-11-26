/*
 * An announcement can wait as its author's draft,
 * As a document's draft does.
 *
 * `post.audience`: `author` while it is a draft, `project` once published.
 * Added with `project` as its default, so every announcement there is stays
 * the project's and no row is rewritten. A published one is never a draft
 * again, and only its author changes the column.
 *
 * Who reads one is said in the policies themselves, and again in each
 * definer function that reads `post` for somebody: search, mentions, who a
 * `posted` note goes to, a push's title. Slack's queue and unfurl already
 * ask `published_at`, which a draft does not have.
 */

alter table post add column audience text not null default 'project'
  check (audience in ('author', 'project'));

/* An author's drafts in a project: a handful, read on the first page of
   the list for the client that asks. */
create index post_drafts on post (project_id, author_id, created_at desc)
  where audience = 'author' and deleted_at is null;

drop policy o_read on post;
create policy o_read on post for select using (
  project_id in (select visible_projects())
  and (audience = 'project' or author_id = current_actor())
);

/*
 * Whether the request is a tool's — a token of any kind, an agent, GitHub
 * or an import acting as somebody — said by the server for the
 * transactions it makes as the request's person (`app.via_tool`, set in
 * `db.ts` from what the request came with). Unset is a person in the
 * product. The floor under `can()`, which keeps `post.publish` from every
 * tool: a draft is made and published only in person.
 */
create function via_tool() returns boolean
language sql stable as $$
  select coalesce(current_setting('app.via_tool', true), '') = 'on'
$$;
grant execute on function via_tool() to tracker_app;

/* A draft is made by its author, in person — never through a tool. */
drop policy o_write on post;
create policy o_write on post for insert with check (
  project_id in (select visible_projects())
  and author_id = current_actor()
  and (audience = 'project' or not via_tool())
);

drop policy o_update on post;
create policy o_update on post for update using (
  project_id in (select visible_projects())
  and (audience = 'project' or author_id = current_actor())
) with check (true);

/*
 * Publishing is the author's, and a published announcement is not made a
 * draft again: what was read was read. Asked of the row whoever writes —
 * the policy above already keeps everybody else from the draft, and this
 * keeps a definer or the table's owner, acting for somebody, to the same.
 */
create function post_audience_is_the_authors() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.audience is distinct from old.audience then
    if new.audience = 'author' then
      raise exception 'An announcement is not made a draft again.' using errcode = '42501';
    end if;
    if current_actor() is not null and current_actor() is distinct from old.author_id then
      raise exception 'Only its author publishes a draft.' using errcode = '42501';
    end if;
    if via_tool() then
      raise exception 'A draft is published in person, not through a tool.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger post_audience_is_the_authors before update of audience on post
  for each row execute function post_audience_is_the_authors();

/*
 * Whether a line about an announcement is kept from the project — asked of
 * the row by `record()`, as `file_apart()` is of a file. Bounded by the
 * session's workspace.
 */
create function post_apart(p uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select x.audience <> 'project' from post x
    where x.id = p and x.workspace_id = current_workspace()
  ), false)
$$;
grant execute on function post_apart(uuid) to tracker_app;

/* No reply on a draft: there is nobody to reply. */
drop policy cmt_write on comment;
create policy cmt_write on comment for insert with check (
  author_id = current_actor()
  and (project_id is null or in_project(project_id))
  and (object_type <> 'post' or exists (
    select 1 from post o where o.id = comment.object_id and o.audience = 'project'))
);

/* Search: its author finds a draft, nobody else does. */
create or replace function search_posts(p_q text, p_project uuid)
returns table (id uuid, number integer, project_id uuid, title text, created_at timestamptz, snippet text)
language sql stable security definer set search_path = public, pg_temp as $$
  with q as (select '%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%' as l)
  select p.id, p.number, p.project_id, p.title, p.created_at,
         case when p.title ilike q.l then null
              else substr(p.said, greatest(1, strpos(lower(p.said), lower(p_q)) - 32), 96) end
  from post p, q
  where p.workspace_id = current_workspace()
    and p.project_id in (select visible_projects())
    and p.deleted_at is null
    and (p.audience = 'project' or p.author_id = current_actor())
    and (p.title ilike q.l or (length(p_q) >= 3 and p.said ilike q.l))
    and (p_project is null or p.project_id = p_project)
  order by p.title ilike q.l desc, p.created_at desc
  limit 20
$$;

/* Who a `posted` note goes to: nobody, for a draft. */
create or replace function post_audience(p_post uuid)
returns table (actor_id uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  select pm.actor_id
  from post p
  join project_member pm on pm.project_id = p.project_id and pm.deleted_at is null
  join membership m on m.workspace_id = p.workspace_id and m.actor_id = pm.actor_id
    and m.deleted_at is null and m.joined_at is not null
  where p.id = p_post and p.deleted_at is null and p.audience = 'project' and is_member(p.workspace_id)
$$;

/* A push names an announcement only once the project has it. */
create or replace function push_about(p_workspace uuid, p_type object_kind, p_id uuid)
returns table (workspace_slug text, title text, number integer, project_slug text, project_key text, conversation uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  select
    w.slug::text,
    coalesce(o.title, c.name, 'A message'),
    o.number,
    p.slug::text,
    p.key,
    c.id
  from workspace w
  left join lateral (
    select t.title, t.number, t.project_id from task t
    where p_type = 'task' and t.id = p_id and t.deleted_at is null
    union all
    select s.title, s.number, s.project_id from post s
    where p_type = 'post' and s.id = p_id and s.deleted_at is null and s.audience = 'project'
    union all
    -- A file's name is its title. One column here rather than a second shape
    -- for the caller to know about.
    select f.name, f.number, f.project_id from file f
    where p_type = 'file' and f.id = p_id and f.deleted_at is null
  ) o on true
  left join project p on p.id = o.project_id and p.deleted_at is null
  left join conversation c
    on c.deleted_at is null
   and c.id = case
        when p_type = 'conversation' then p_id
        when p_type = 'message' then (select m.conversation_id from message m where m.id = p_id)
      end
  where w.id = p_workspace
$$;

/* A mention in a draft tells nobody, and does not say it exists. */
create or replace function may_read(p_actor uuid, p_kind object_kind, p_id uuid)
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
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
      /* As `o_read` on post has it since 320. */
      select exists (
        select 1 from post x
        where x.id = p_id and x.deleted_at is null
          and x.project_id in (select visible_projects())
          and (x.audience = 'project' or x.author_id = p_actor)
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
