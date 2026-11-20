/*
 * What the second review of co-editing found,
 * Beside migration 233 (written as 231 on its branch), which made
 * the fold, `file.rev` and `file_rev`.
 *
 * 1. Folding a document's state, and keeping a revision of its body, only
 *    inside a transaction where the application has asked `mayEdit` for
 *    that file and said so: `app.may_edit_file`, set by the server after
 *    the question (`proved` in `server/src/coedit.ts`). The edit right is
 *    `can()`'s and stays in TypeScript; this is the database refusing a
 *    transaction that never asked it. A reader's socket never says it, so
 *    a reader cannot fold a document's state away, however it is asked.
 *    It is a setting as `app.actor_id` is, and trusted as far.
 *
 * 2. Revisions kept by a budget rather than a count: the last ten, and of
 *    those no more than two megabytes of bodies, the newest always kept.
 *    `rev` now moves with the version and with writes from the API only,
 *    so ten revisions are many minutes of a document being written.
 */

-- 1.
create or replace function file_yjs_fold(p_file uuid, p_rows uuid[], p_state bytea) returns void
language plpgsql security definer set search_path = public as $$
declare
  ws uuid;
begin
  if coalesce(current_setting('app.may_edit_file', true), '') <> p_file::text then
    raise exception 'not asked whether this document may be edited' using errcode = '42501';
  end if;
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

drop policy file_rev_write on file_rev;
create policy file_rev_write on file_rev for insert to tracker_app
  with check (
    coalesce(current_setting('app.may_edit_file', true), '') = file_rev.file_id::text
    and exists (select 1 from file f where f.id = file_rev.file_id and f.workspace_id = file_rev.workspace_id)
  );

-- 2.
create or replace function file_rev_keep() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from file_rev r
  where r.file_id = new.file_id and r.rev < new.rev
    and r.rev not in (
      select k.rev from (
        select x.rev, sum(pg_column_size(x.body)) over (order by x.rev desc) as running,
               row_number() over (order by x.rev desc) as n
        from file_rev x where x.file_id = new.file_id
      ) k
      where k.n <= 10 and (k.n = 1 or k.running <= 2 * 1024 * 1024)
    );
  return new;
end $$;
