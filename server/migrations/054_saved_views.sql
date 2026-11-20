/*
 * A view somebody arranged, with a name.
 *
 * The query and nothing else: what you are looking at already lives in the
 * address, so a view is a URL with a name on it. What a row *shows* is not
 * here, because that is how somebody likes it drawn rather than what they are
 * looking at.
 *
 * One person's, like the sidebar's order: which five questions somebody asks
 * of a list every morning is not a question the team has one answer to.
 */
create table saved_view (
  id uuid primary key,
  workspace_id uuid not null references workspace(id),
  actor_id uuid not null references actor(id),
  -- A saved view names a list, and a list belongs to a project. One that
  -- crosses projects is the overview screen the design puts in stage six.
  project_id uuid not null references project(id),
  name text not null,
  /* The query as the address spells it, so applying one is a navigation and
     nothing else. */
  query text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

/* The same name twice is the same view, which is what somebody who typed it
   again meant. */
create unique index saved_view_name on saved_view (actor_id, project_id, name);
create index saved_view_by_project on saved_view (actor_id, project_id);

alter table saved_view enable row level security;

create policy saved_view_own on saved_view for all to tracker_app
  using (actor_id = current_actor()
         and (current_workspace() is null or workspace_id = current_workspace()))
  with check (actor_id = current_actor()
              and (current_workspace() is null or workspace_id = current_workspace()));

grant select, insert, update, delete on saved_view to tracker_app;
