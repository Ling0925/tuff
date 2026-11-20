-- A document anybody can read, by its link.

alter table file add column if not exists public_token text unique;
alter table file add column if not exists public_at timestamptz;

/* The shared document: written, standing, its project standing. */
create or replace function public_document(p_token text)
returns table (id uuid, name text, body jsonb, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select f.id, f.name, f.body, f.updated_at
  from file f
  left join project p on p.id = f.project_id
  where f.public_token = p_token and f.public_token is not null
    and f.deleted_at is null and f.body is not null
    and f.storage_key is null and f.url is null
    and (p.id is null or p.deleted_at is null)
$$;
grant execute on function public_document to tracker_app;

/* The pictures that document names — only those, and only standing. */
create or replace function public_document_files(p_token text)
returns table (id uuid, storage_key text, display_key text, content_type text)
language sql stable security definer set search_path = public as $$
  select x.id, x.storage_key, x.display_key, x.content_type
  from public_document(p_token) d
  join file src on src.id = d.id
  join file x on x.workspace_id = src.workspace_id and x.deleted_at is null and x.storage_key is not null
  where x.id::text in (select jsonb_path_query(d.body, 'strict $.**.fileId') #>> '{}')
$$;
grant execute on function public_document_files to tracker_app;
