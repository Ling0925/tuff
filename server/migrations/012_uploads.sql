-- Files that are uploaded rather than written.
--
-- The row already exists: a document is a file with a body, an upload is a
-- file with a storage key. What was missing is the bookkeeping around the
-- bytes — what is stored, how much of it, and the ceiling per workspace.
alter table file add column uploaded_at timestamptz;
alter table file add column checksum text;

-- Limits live on the workspace because that is what is sold: a flat price per
-- workspace only works if there is a ceiling somewhere, and storage is the
-- half of the margin that is not sync traffic.
create function workspace_storage_bytes(ws uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(sum(size_bytes), 0)::bigint from file
  where workspace_id = ws and deleted_at is null and size_bytes is not null
$$;

grant execute on function workspace_storage_bytes to tracker_app;

create index file_by_project on file (project_id) where deleted_at is null;
