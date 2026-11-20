/*
 * A held file asked about its own document row by row — 286's
 * `file_held_open` — cost a Docs list of a thousand documents and two
 * thousand held pictures 1.2 seconds under `pnpm load`: one definer call a
 * row. The set of every document the asker may see (285) cost a single
 * picture's link 36 ms. Neither is right for both, and both carried a
 * fallback for a document that is not there.
 *
 * So a held file cannot outlive its document: `held_by` is a foreign key,
 * and the document's row going takes its kept files with it or lets the
 * project's go to the project, in the same transaction, so the key holds
 * when it ends. A
 * document that is not there is then not a case the reads need to answer,
 * and the policy asks one small set once a query: the documents of the
 * workspace kept from the asker — drafts that are not theirs, documents of
 * chosen people they are not among. A held file is seen unless its
 * document is in it.
 *
 * Changes no rows (every `held_by` names a document that is there: 286's
 * trigger saw to it).
 */

/* The kept documents of the session's workspace not the asker's to see. */
create function documents_kept_from_me() returns setof uuid
language sql stable security definer set search_path = public as $$
  select d.id from file d
  where d.workspace_id = current_workspace()
    and d.audience <> 'project'
    and d.author_id is distinct from current_actor()
    and not (d.audience = 'chosen' and exists (
      select 1 from file_reader r
      where r.workspace_id = d.workspace_id and r.file_id = d.id and r.actor_id = current_actor()))
$$;
grant execute on function documents_kept_from_me() to tracker_app;

drop index if exists file_kept_by_project;
create index file_kept_documents on file (workspace_id) where audience <> 'project';

drop policy o_read on file;
create policy o_read on file for select using (
  (project_id is null or project_id in (select visible_projects()))
  and (conversation_id is null or conversation_id in (select visible_conversations()))
  and (audience = 'project' or author_id = current_actor()
       or (audience = 'chosen' and chosen_for(id, workspace_id)))
  and (held_by is null or author_id = current_actor() or not (held_by in (select documents_kept_from_me())))
);

drop policy o_update on file;
create policy o_update on file for update using (
  (project_id is null or project_id in (select visible_projects()))
  and (conversation_id is null or conversation_id in (select visible_conversations()))
  and (audience = 'project' or author_id = current_actor()
       or (audience = 'chosen' and chosen_for(id, workspace_id)))
  and (held_by is null or author_id = current_actor() or not (held_by in (select documents_kept_from_me())))
) with check (true);

/* ------------------------------------------------- the key

   Checked when the transaction ends, not when the row goes: the clear-out
   (`file_kept_goes_whole`, after each row) deletes a kept document's files
   or lets a project document's go in the same transaction, and a project's
   or a workspace's purge deletes the files of the same statement — a
   trigger that changed rows its own statement was about to delete would
   fail it. */
alter table file add constraint file_held_by_a_document
  foreign key (held_by) references file (id) deferrable initially deferred not valid;
alter table file validate constraint file_held_by_a_document;

/* ------------------------------------------------- 286: search, through the same set

   A held picture's name matched in ten thousand rows asked its document ten
   thousand times (321 ms under `pnpm load`); one set, as the policy has it. */
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
    and (f.held_by is null or f.author_id = current_actor() or not (f.held_by in (select documents_kept_from_me())))
    and f.deleted_at is null
    and (f.name ilike q.l or (length(p_q) >= 3 and f.said ilike q.l))
    and (p_project is null or f.project_id = p_project)
  order by f.name ilike q.l desc, f.created_at desc
  limit 20
$$;
