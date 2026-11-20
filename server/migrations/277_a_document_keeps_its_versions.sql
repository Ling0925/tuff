/*
 * A document's versions.
 *
 * One row each time a written document's version moves: the body it then
 * said, the version number it carries, who wrote in it since the version
 * before, and — for a restore — which version it put back. History is
 * added to and thinned, never rewritten: the application inserts and reads,
 * and the thinning is the insert's own.
 */
create table file_version (
  workspace_id uuid not null references workspace(id) on delete cascade,
  id uuid not null,
  /* The clear-out taking the document takes its versions. */
  file_id uuid not null references file(id) on delete cascade,
  version integer not null check (version > 0),
  body jsonb not null,
  /* Who wrote in it since the version before; none for the body a
     document had before history began. */
  contributors uuid[] not null default '{}',
  restored_version integer,
  created_at timestamptz not null default now(),
  primary key (workspace_id, id)
);
/* The list, newest first, by the uuidv7 the server gives each. */
create index file_version_by_file on file_version (workspace_id, file_id, id desc);

alter table file_version enable row level security;

/*
 * Read by whoever can read the document: in the session's workspace, and
 * through the file's own policies — its project, a token's projects, and
 * whatever the document's own visibility adds to them later.
 */
create policy file_version_read on file_version for select to tracker_app using (
  workspace_id = current_workspace()
  and exists (select 1 from file f
              where f.id = file_version.file_id and f.workspace_id = file_version.workspace_id
                and f.deleted_at is null)
);

/*
 * Kept only inside a transaction where the server has asked `mayEdit` for
 * this file and said so (`app.may_edit_file`, migration 235): a reader's
 * transaction cannot plant a version for anybody to restore.
 */
create policy file_version_keep on file_version for insert to tracker_app with check (
  workspace_id = current_workspace()
  and coalesce(current_setting('app.may_edit_file', true), '') = file_version.file_id::text
  and exists (select 1 from file f
              where f.id = file_version.file_id and f.workspace_id = file_version.workspace_id
                and f.deleted_at is null
                and f.body is not null and f.storage_key is null and f.url is null)
);
grant select, insert on file_version to tracker_app;

/*
 * Thinned as it ages, by the insert itself: every version of the last day,
 * the last of each day for thirty days, the last of each week before that;
 * of those at most 250, and past the newest ten only while they come to
 * 64 MB of bodies. The newest is always kept. A definer, so the
 * application needs no delete right on the table.
 */
create function file_version_thin() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  with b as (
    select x.id, x.created_at, pg_column_size(x.body) as size,
           case
             when x.created_at > now() - interval '1 day' then x.id::text
             when x.created_at > now() - interval '30 days' then date_trunc('day', x.created_at)::text
             else 'w' || date_trunc('week', x.created_at)::text
           end as bucket
    from file_version x
    where x.workspace_id = new.workspace_id and x.file_id = new.file_id
  ), last_of as (
    select id, created_at, size,
           row_number() over (partition by bucket order by created_at desc, id desc) as in_bucket
    from b
  ), k as (
    select id,
           row_number() over (order by created_at desc, id desc) as n,
           sum(size) over (order by created_at desc, id desc) as running
    from last_of where in_bucket = 1
  )
  delete from file_version v
  where v.workspace_id = new.workspace_id and v.file_id = new.file_id
    and v.id not in (
      select k.id from k
      where k.n = 1 or (k.n <= 250 and (k.n <= 10 or k.running <= 64 * 1024 * 1024))
    );
  return new;
end $$;
revoke all on function file_version_thin() from public;
create trigger file_version_thin after insert on file_version
  for each row execute function file_version_thin();
