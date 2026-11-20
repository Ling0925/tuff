/*
 * Who deleted a row in Docs, while it waits for the clear-out — so Undo is
 * theirs, or the business of whoever may delete anybody's, and not its
 * author's for thirty days after a manager took it down.
 */
alter table file add column if not exists deleted_by uuid references actor(id) on delete set null;

/*
 * A file that goes for good takes what hangs on it.
 *
 * Deleting something in Docs is soft, and the clear-out takes the row thirty
 * days later (`purge_deleted`), its bytes queued by `file_bytes_go_with_it`
 * (migration 101). Its comments, who was following it and the links to and
 * from it are rows about it by type and id, not foreign keys, so nothing
 * took them: they stayed as rows nothing reads. They go in the same
 * statement as the file's row now, whoever removes it.
 *
 * The project's own purge clears these itself before its files; here they
 * are already gone and this finds nothing.
 */
create or replace function file_takes_what_hangs_on_it() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from comment where object_type = 'file' and object_id = old.id;
  delete from subscription where object_type = 'file' and object_id = old.id;
  delete from object_link
  where (from_type = 'file' and from_id = old.id) or (to_type = 'file' and to_id = old.id);
  return old;
end $$;
revoke execute on function file_takes_what_hangs_on_it() from public;

drop trigger if exists file_takes_what_hangs_on_it on file;
create trigger file_takes_what_hangs_on_it after delete on file
  for each row execute function file_takes_what_hangs_on_it();
