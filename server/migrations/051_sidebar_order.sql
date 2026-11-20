/*
 * Where one person keeps a project or a conversation in their own sidebar.
 *
 * A service record: the thing being recorded is not a property of the project
 * but of one person's relationship to it, so it is neither a fifth entity nor
 * a column on one of the four. `docs/specs/sidebar-order.md`.
 *
 * Not on `project_member`, which looks like the right home until you remember
 * that an owner sees every project in the workspace whether or not they are
 * on it — most of an owner's sidebar would have no row to hang a key on.
 */
create table sidebar_place (
  id uuid primary key,
  workspace_id uuid not null references workspace(id),
  actor_id uuid not null references actor(id),
  -- Only these two are ever placed; the enum already has both.
  kind object_kind not null,
  -- No foreign key, because it points at one of two tables — the same
  -- bargain `activity_event` makes for the same reason.
  object_id uuid not null,
  sort_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index sidebar_place_unique
  on sidebar_place (actor_id, workspace_id, kind, object_id);
-- The order is read per person per workspace, which is the only way it is read.
create index sidebar_place_by_actor on sidebar_place (actor_id, workspace_id, kind, sort_key);

alter table sidebar_place enable row level security;

/*
 * Nobody else's, ever — and bounded by the session's workspace as well as by
 * the actor, the same as every other policy since 044.
 */
create policy sp_own on sidebar_place for all to tracker_app
  using (
    actor_id = current_actor()
    and (current_workspace() is null or workspace_id = current_workspace())
  )
  with check (
    actor_id = current_actor()
    and (current_workspace() is null or workspace_id = current_workspace())
  );

grant select, insert, update, delete on sidebar_place to tracker_app;
