/*
 * Who a document's files are for, asked once a query rather than once a
 * row.
 *
 * `pnpm load` with a thousand documents in the big project, two thirds of
 * them kept: the Docs list took 448 ms, a person's page 2.7 s and My Tasks'
 * "what I touched" 2.2 s. Each row of a file put into a document, and each
 * line of the feed about a file, called a definer function of its own; a
 * row-level policy is evaluated before the query's own conditions, so the
 * feed's lines about tasks paid for every line about a file beside them.
 *
 * Now each is a set made once a query, as `visible_projects()` is: the
 * documents in the workspace the asker may see (for files put into one),
 * and the files kept from the asker (for the feed). A file whose document
 * is not there is in neither set: seen by its uploader alone, as since 282.
 *
 * Changes no rows.
 */

/* The written documents of the session's workspace the asker may see by
   who they are for. A document not there is in it for nobody. */
create function documents_open_to_me() returns setof uuid
language sql stable security definer set search_path = public as $$
  select d.id from file d
  where (current_workspace() is null or d.workspace_id = current_workspace())
    and d.body is not null and d.storage_key is null and d.url is null
    and (d.audience = 'project' or d.author_id = current_actor()
         or (d.audience = 'chosen' and exists (
           select 1 from file_reader r
           where r.workspace_id = d.workspace_id and r.file_id = d.id and r.actor_id = current_actor())))
$$;
grant execute on function documents_open_to_me() to tracker_app;

/* The files of the session's workspace kept from the asker by who they are
   for: documents not theirs to see, and the files put into those. */
create function files_kept_from_me() returns setof uuid
language sql stable security definer set search_path = public as $$
  with kept as (
    select d.id, d.workspace_id from file d
    where (current_workspace() is null or d.workspace_id = current_workspace()) and d.audience <> 'project'
      and d.author_id is distinct from current_actor()
      and not (d.audience = 'chosen' and exists (
        select 1 from file_reader r
        where r.workspace_id = d.workspace_id and r.file_id = d.id and r.actor_id = current_actor()))
  )
  select id from kept
  union all
  select x.id from file x join kept on x.origin_id = kept.id
  where x.origin_type = 'file' and x.workspace_id = kept.workspace_id
$$;
grant execute on function files_kept_from_me() to tracker_app;

/* Kept documents found by the workspace alone. */
create index file_kept_documents on file (workspace_id) where audience <> 'project';

drop policy o_read on file;
create policy o_read on file for select using (
  (project_id is null or project_id in (select visible_projects()))
  and (conversation_id is null or conversation_id in (select visible_conversations()))
  and (audience = 'project' or author_id = current_actor()
       or (audience = 'chosen' and chosen_for(id, workspace_id)))
  and (origin_type is distinct from 'file' or author_id = current_actor()
       or origin_id in (select documents_open_to_me()))
);

drop policy o_update on file;
create policy o_update on file for update using (
  (project_id is null or project_id in (select visible_projects()))
  and (conversation_id is null or conversation_id in (select visible_conversations()))
  and (audience = 'project' or author_id = current_actor()
       or (audience = 'chosen' and chosen_for(id, workspace_id)))
  and (origin_type is distinct from 'file' or author_id = current_actor()
       or origin_id in (select documents_open_to_me()))
) with check (true);

drop policy ae_read on activity_event;
create policy ae_read on activity_event for select using (
  workspace_id in (select staff_workspaces())
  and (
    (project_id is not null and project_id in (select visible_projects()))
    or (project_id is null and object_type is distinct from 'conversation'
        and (actor_id = current_actor() or workspace_id in (select owned_workspaces())))
    or (project_id is null and object_type = 'conversation' and object_id in (select visible_conversations()))
  )
  and (object_type is distinct from 'file' or object_id is null
       or not (object_id in (select files_kept_from_me())))
);
