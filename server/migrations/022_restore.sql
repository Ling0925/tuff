-- Seeing what is in the bin, and taking it back out.
--
-- Deleting a project says it is reversible until a scheduled clear-out, and
-- until now nothing could reverse it: row-level security hides a deleted row
-- from everybody, which is right everywhere except on the one screen whose
-- whole job is to show them.
--
-- Definer, and scoped to the workspace the caller is in. The permission is
-- checked in the handler — the same `project.archive` that deleted it.
create function deleted_projects(p_workspace uuid)
returns table (id uuid, name text, description text, deleted_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.description, p.deleted_at
  from project p
  where p.workspace_id = p_workspace and p.deleted_at is not null
  order by p.deleted_at desc
$$;

create function restore_project(p_workspace uuid, p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare hit uuid;
begin
  update project set deleted_at = null
  where id = p_id and workspace_id = p_workspace and deleted_at is not null
  returning id into hit;
  return hit is not null;
end $$;

grant execute on function deleted_projects, restore_project to tracker_app;
