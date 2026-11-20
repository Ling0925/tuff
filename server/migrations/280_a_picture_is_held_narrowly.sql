/*
 * What the second review of found.
 *
 * A document became a file's place (`origin_type = 'file'`) too easily: a
 * comment on a document the project had claimed any file it named with no
 * place yet, wherever it was — and narrowing that document then hid the
 * file from everybody, and its clear-out took it to the bin. A late claim
 * is narrow now (`claimFiles`), and it needs to know whether any other body
 * has named the file: `file.named_elsewhere`, set by every body that names
 * a file other than its own place.
 *
 * The clear-out of a kept document takes only what is wholly its own: a
 * file whose place it is, in its project, that nothing else named.
 *
 * And an owner chosen while on no project who is made a member loses the
 * places only the owner's role gave them.
 *
 * Changes no rows.
 */

alter table file add column named_elsewhere boolean not null default false;

/* ------------------------------------------------- 279 */

create or replace function file_kept_goes_whole() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.audience <> 'project' then
    with own as (
      select x.id from file x
      where x.workspace_id = old.workspace_id and x.origin_type = 'file' and x.origin_id = old.id
        and x.project_id is not distinct from old.project_id and not x.named_elsewhere
    ), lines as (
      delete from activity_event
      where workspace_id = old.workspace_id and object_type = 'file'
        and (object_id = old.id or object_id in (select id from own))
    )
    update file set deleted_at = coalesce(deleted_at, now())
    where id in (select id from own);
  end if;
  return old;
end $$;

/* ------------------------------------------------- an owner no longer */

create function file_reader_goes_with_the_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from file_reader r using file f
  where r.workspace_id = new.workspace_id and r.actor_id = new.actor_id and f.id = r.file_id
    and not exists (
      select 1 from project_member pm
      where pm.project_id = f.project_id and pm.actor_id = new.actor_id and pm.deleted_at is null);
  return null;
end $$;
revoke execute on function file_reader_goes_with_the_role() from public;
create trigger file_reader_goes_with_the_role after update of role on membership
  for each row when (old.role = 'owner' and new.role is distinct from 'owner')
  execute function file_reader_goes_with_the_role();
