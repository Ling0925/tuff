/*
 * A repository's link stops when the person it acts as can no longer act.
 * Everything GitHub changes is
 * done as whoever linked the repository; if they have left the workspace,
 * or may no longer change the project, nobody else's rights are borrowed to
 * carry on. The link is kept, stopped, with why — so the project's settings
 * can say so and whoever may can link it again as themselves.
 */
alter table github_link add column stopped_at timestamptz;
alter table github_link add column stopped_why text;

create function github_link_stop(p_link uuid, p_why text) returns void
language sql volatile security definer set search_path = public as $$
  update github_link set stopped_at = now(), stopped_why = p_why
  where id = p_link and stopped_at is null
$$;
grant execute on function github_link_stop(uuid, text) to tracker_app;

/* A stopped link routes nothing, either way. */
create or replace function github_route(p_installation bigint, p_repo bigint)
returns table (workspace_id uuid, install_id uuid, link_id uuid, project_id uuid,
               project_key text, linked_by uuid, issues boolean)
language sql stable security definer set search_path = public as $$
  select i.workspace_id, i.id, l.id, l.project_id, p.key::text, l.linked_by, l.issues
  from github_install i
  left join github_link l on l.install_id = i.id and l.repo_id = p_repo and l.deleted_at is null and l.stopped_at is null
  left join project p on p.id = l.project_id and p.deleted_at is null
  where i.installation_id = p_installation and i.deleted_at is null
$$;

create or replace function github_target(p_project uuid) returns table (
  link_id uuid, repo_name text, installation_id bigint, linked_by uuid, issues boolean, workspace_id uuid, project_key text
)
language sql stable security definer set search_path = public as $$
  select l.id, l.repo_name, i.installation_id, l.linked_by, l.issues, l.workspace_id, p.key::text
  from github_link l
  join github_install i on i.id = l.install_id and i.deleted_at is null
  join project p on p.id = l.project_id
  where l.project_id = p_project and l.deleted_at is null and l.stopped_at is null
$$;
