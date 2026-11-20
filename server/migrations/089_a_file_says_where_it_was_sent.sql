-- Where a file was put — `docs/specs/docs.md`.
--
-- A picture sent in a room or put on a task becomes a row in the project's
-- Docs, and the row said nothing of where it came from: forty screenshots
-- and no way back to the conversation they were the subject of. The first
-- place a file is used is written on it — a message, a task, a post, or the
-- thing a comment was left on — and the list links there.
alter table file add column origin_type text check (origin_type in ('message', 'task', 'post', 'file'));
alter table file add column origin_id uuid;

-- And the files already used, from the bodies that hold them: each file's
-- first use, oldest first.
with uses as (
  select (a ->> 'fileId')::uuid as file_id, 'message' as kind, m.id as origin, m.created_at
  from message m, jsonb_path_query(m.body, 'strict $.**.attrs') a
  where m.body::text like '%"fileId"%' and a ? 'fileId'
  union all
  select (a ->> 'fileId')::uuid, 'task', t.id, t.created_at
  from task t, jsonb_path_query(t.body, 'strict $.**.attrs') a
  where t.body::text like '%"fileId"%' and a ? 'fileId'
  union all
  select (a ->> 'fileId')::uuid, 'post', p.id, p.created_at
  from post p, jsonb_path_query(p.body, 'strict $.**.attrs') a
  where p.body::text like '%"fileId"%' and a ? 'fileId'
),
first as (
  select distinct on (file_id) file_id, kind, origin
  from uses
  where file_id is not null
  order by file_id, created_at
)
update file f set origin_type = first.kind, origin_id = first.origin
from first where f.id = first.file_id and f.origin_type is null;

-- And those put on a comment: the thing the comment was left on.
with uses as (
  select (a ->> 'fileId')::uuid as file_id, c.object_type::text as kind, c.object_id as origin, c.created_at
  from comment c, jsonb_path_query(c.body, 'strict $.**.attrs') a
  where c.body::text like '%"fileId"%' and a ? 'fileId'
    and c.object_type::text in ('task', 'post', 'file')
),
first as (
  select distinct on (file_id) file_id, kind, origin from uses
  where file_id is not null order by file_id, created_at
)
update file f set origin_type = first.kind, origin_id = first.origin
from first where f.id = first.file_id and f.origin_type is null;
