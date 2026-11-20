/*
 * What the security review of co-editing found,
 * Three things, each beside what migration 229 made.
 *
 * 1. The application deletes from `file_yjs` only to fold a document's rows
 *    into one, and that is now a function's: `file_yjs_fold` takes the
 *    rows to fold and the state they come to, for a document the caller can
 *    see, and nothing else. The application keeps select and insert, under
 *    the same policy as before, and loses delete.
 *
 * 2. `file.rev` counts every write of a document's body — the debounced
 *    writes from the shared state included, which do not move `version` —
 *    so a caller can say exactly which body it read (`base_rev` on
 *    `PATCH /api/files/:id`).
 *
 * 3. `file_rev` keeps the bodies those revisions replaced, the last thirty
 *    a document had, so an edit from outside is merged against the body
 *    its caller read rather than against whatever is stored now. Older
 *    than that, the caller is told to read again.
 */

/* Numbered 233: it was written as 231 beside the selection comments' 231,
   and a development database may have applied it under that name, so
   every statement here may be met by what it makes. */

-- 1.
drop policy if exists file_yjs_by_file on file_yjs;
drop policy if exists file_yjs_read on file_yjs;
drop policy if exists file_yjs_write on file_yjs;
create policy file_yjs_read on file_yjs for select to tracker_app
  using (exists (select 1 from file f where f.id = file_yjs.file_id));
create policy file_yjs_write on file_yjs for insert to tracker_app
  with check (exists (
    select 1 from file f
    where f.id = file_yjs.file_id and f.workspace_id = file_yjs.workspace_id
      and f.body is not null and f.storage_key is null and f.url is null
  ));
revoke delete on file_yjs from tracker_app;

create or replace function file_yjs_fold(p_file uuid, p_rows uuid[], p_state bytea) returns void
language plpgsql security definer set search_path = public as $$
declare
  ws uuid;
begin
  /* The caller's own view of the file: the session's workspace, its
     projects, its token's projects. A definer sees past the policies, so
     it asks them itself. */
  select f.workspace_id into ws from file f
  where f.id = p_file and f.deleted_at is null
    and f.body is not null and f.storage_key is null and f.url is null
    and f.project_id in (select visible_projects());
  if ws is null then
    raise exception 'no such document' using errcode = '42501';
  end if;
  delete from file_yjs where file_id = p_file and id = any (p_rows);
  insert into file_yjs (id, workspace_id, file_id, bytes, actor_id)
  values (gen_random_uuid(), ws, p_file, p_state, null);
end $$;
revoke all on function file_yjs_fold(uuid, uuid[], bytea) from public;
grant execute on function file_yjs_fold(uuid, uuid[], bytea) to tracker_app;

-- 2.
alter table file add column if not exists rev integer not null default 0;

-- 3.
create table if not exists file_rev (
  workspace_id uuid not null references workspace(id),
  file_id uuid not null references file(id) on delete cascade,
  rev integer not null,
  body jsonb not null,
  created_at timestamptz not null default now(),
  primary key (file_id, rev)
);

alter table file_rev enable row level security;
drop policy if exists file_rev_read on file_rev;
drop policy if exists file_rev_write on file_rev;
create policy file_rev_read on file_rev for select to tracker_app
  using (exists (select 1 from file f where f.id = file_rev.file_id));
create policy file_rev_write on file_rev for insert to tracker_app
  with check (exists (select 1 from file f where f.id = file_rev.file_id and f.workspace_id = file_rev.workspace_id));
grant select, insert on file_rev to tracker_app;

/* The last thirty, kept by the insert itself: a definer, so pruning needs
   no delete right of the application's. */
create or replace function file_rev_keep() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from file_rev where file_id = new.file_id and rev <= new.rev - 30;
  return new;
end $$;
drop trigger if exists file_rev_keep on file_rev;
create trigger file_rev_keep after insert on file_rev
  for each row execute function file_rev_keep();
