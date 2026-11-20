-- A picture's copy for showing.
--
-- The original is what was uploaded and what is saved and opened full
-- size; the copy is what a message, a comment or a task draws: the same
-- picture at no more than 1600 pixels on its long side, made by the
-- browser that uploaded it. A row, not a second file: it is the same
-- picture, it is not in Docs, and it goes when the file goes.
alter table file add column display_key text;
alter table file add column display_bytes bigint;

-- And it counts against the workspace's storage, as every byte stored does.
create or replace function workspace_storage_bytes(ws uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(sum(size_bytes + coalesce(display_bytes, 0)), 0)::bigint from file
  where workspace_id = ws and deleted_at is null and size_bytes is not null
$$;
