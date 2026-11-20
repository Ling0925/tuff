/*
 * Writing a document together.
 *
 * The Yjs state of a written document, beside its ProseMirror body: a row
 * per update somebody's page sent and the server accepted, folded into one
 * row every time the body is written from them. `file.body` stays what
 * everything else reads; this is what the people in the document share.
 *
 * A child of the file in every way: gone with it, visible exactly when it
 * is, and in its workspace. The application inserts a row as the person
 * who sent it, so the policy is what refuses somebody who can no longer see
 * the file at the moment of the write — the edit right itself is `can()`'s,
 * asked before the insert (`server/src/coedit.ts`), as it is for every
 * other write to a file.
 */
create table file_yjs (
  id uuid primary key,
  workspace_id uuid not null references workspace(id),
  file_id uuid not null references file(id) on delete cascade,
  bytes bytea not null,
  /* Who sent it; a folded row is nobody's. Gone with their account. */
  actor_id uuid references actor(id) on delete set null,
  created_at timestamptz not null default now()
);

/* Every read is "all of one file's rows". */
create index file_yjs_by_file on file_yjs (file_id);

alter table file_yjs enable row level security;

/*
 * The file's own policies answer the `exists`, so a project the person
 * cannot read, a room's file they are not in, another workspace and a
 * token held to other projects all hide the row from both ends. Only a
 * written document has a state: not an upload, a link or a folder.
 */
create policy file_yjs_by_file on file_yjs for all to tracker_app
  using (exists (select 1 from file f where f.id = file_yjs.file_id))
  with check (exists (
    select 1 from file f
    where f.id = file_yjs.file_id and f.workspace_id = file_yjs.workspace_id
      and f.body is not null and f.storage_key is null and f.url is null
  ));
grant select, insert, delete on file_yjs to tracker_app;
