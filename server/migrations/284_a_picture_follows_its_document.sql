/*
 * What the fourth review of found.
 * Again machinery is taken away where it can be.
 *
 * 1. Nothing lets a picture go any more: a file put into a document
 *    follows that document, wherever else it is named (`claimFiles`). No
 *    schema for that — it is the server's absence of a write.
 * 2. Whether a file is apart from the project — told to no socket and no
 *    webhook — was read under the asker's own policies, so an uploader who
 *    could not see the document their picture was put into got it told as
 *    the project's. `file_apart()` asks it of the row, bounded by the
 *    workspace; a picture whose document is gone is apart, as the read
 *    policy has it (its uploader's alone).
 * 3. The two sets of 283 read every workspace's files when a session had
 *    none, and every project's when it had one: they are bounded now by
 *    the session's workspace and the asker's projects, and read through
 *    indexes by project.
 * 4. A document's chosen people are people: an agent is not one of them.
 *
 * Changes no rows.
 */

create function file_apart(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select f.audience <> 'project'
        or (f.origin_type = 'file' and not exists (
              select 1 from file d
              where d.id = f.origin_id and d.workspace_id = f.workspace_id and d.audience = 'project'))
        or coalesce((select cv.chosen or cv.project_id is null from conversation cv where cv.id = f.conversation_id), false)
    from file f
    where f.id = p and f.workspace_id = current_workspace()
  ), false)
$$;
grant execute on function file_apart(uuid) to tracker_app;

drop index if exists file_kept_documents;
create index file_documents_by_project on file (project_id) where body is not null and storage_key is null and url is null;
create index file_kept_by_project on file (project_id) where audience <> 'project';
create index file_put_into_by_project on file (project_id) where origin_type = 'file';

/* ------------------------------------------------- 283 */

create or replace function documents_open_to_me() returns setof uuid
language sql stable security definer set search_path = public as $$
  select d.id from file d
  where d.workspace_id = current_workspace()
    and d.project_id = any (array(select visible_projects()))
    and d.body is not null and d.storage_key is null and d.url is null
    and (d.audience = 'project' or d.author_id = current_actor()
         or (d.audience = 'chosen' and exists (
           select 1 from file_reader r
           where r.workspace_id = d.workspace_id and r.file_id = d.id and r.actor_id = current_actor())))
$$;

/* Kept from the asker: documents not theirs to see, and every file put into
   a document that is not theirs to see — one that is gone included — that
   they did not upload themselves. As `o_read` has it. */
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
    and x.origin_type = 'file'
    and x.author_id is distinct from current_actor()
    and not (x.origin_id in (select documents_open_to_me()))
$$;

/* ------------------------------------------------- 279: chosen people are people */

create or replace function chosen_may_be(p_file uuid, p_actor uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from file f
    join membership m on m.workspace_id = f.workspace_id and m.actor_id = p_actor
      and m.deleted_at is null and m.joined_at is not null
    where f.id = p_file
      and (current_workspace() is null or f.workspace_id = current_workspace())
      and not exists (select 1 from agent g where g.actor_id = p_actor)
      and (m.role = 'owner' or exists (
        select 1 from project_member pm
        where pm.project_id = f.project_id and pm.actor_id = p_actor and pm.deleted_at is null))
  )
$$;
