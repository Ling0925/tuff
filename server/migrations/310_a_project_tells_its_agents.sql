/*
 * One written document of a project is its instructions for agents.
 *
 * A mark on the file, not a pointer on the project: everything that can
 * take a document away from agents — the bin, narrowing it to chosen
 * people, moving it — happens to the file's own row, and a trigger there
 * takes the mark off with it, whichever path did it.
 *
 * The database holds three things:
 *
 * - **What it can be on**: a written document the whole project reads, in a
 *   project, in no room, not in the bin (a check).
 * - **One per project** (a unique partial index).
 * - **Who changes it** (a trigger): somebody signed in needs the owner's
 *   role or `manage` on the project, and is never an agent. `can()` asks
 *   more — the document's edit right, never through a token — and the
 *   server asks it first; this is the floor.
 *
 * Changes no rows: every file comes in unmarked.
 */

alter table file add column for_agents boolean not null default false;

alter table file add constraint file_for_agents_is_a_projects_document
  check (not for_agents or (
    audience = 'project' and project_id is not null and conversation_id is null and deleted_at is null
    and body is not null and storage_key is null and url is null)) not valid;
alter table file validate constraint file_for_agents_is_a_projects_document;

create unique index file_for_agents_one_per_project on file (project_id) where for_agents;

/*
 * Taken off when the document goes where agents cannot follow: to the bin,
 * to chosen people, to another project. Before the check is asked, so the
 * write that trashes or narrows it is never refused for the mark it held.
 * A restored document comes back unmarked.
 */
create function file_for_agents_follows() returns trigger
language plpgsql as $$
begin
  if new.for_agents and (
    new.deleted_at is not null
    or new.audience <> 'project'
    or new.project_id is distinct from old.project_id) then
    new.for_agents := false;
  end if;
  return new;
end $$;
grant execute on function file_for_agents_follows() to tracker_app;

create trigger file_for_agents_follows
  before update of deleted_at, audience, project_id on file
  for each row execute function file_for_agents_follows();

/* Whether the one asking may change the mark on this project: the owner
   (with an address somebody proved), or `manage` there — never an agent. A
   definer, because who is an agent is read under the agent table's own
   policy. */
create function may_point_agents(p_project uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select p_project is not null
    and not exists (select 1 from agent g where g.actor_id = current_actor())
    and (
      exists (
        select 1 from project pr
        where pr.id = p_project and role_in(pr.workspace_id) = 'owner'
          and auth_email_confirmed(current_actor()) is not false)
      or exists (
        select 1 from project_member pm
        where pm.project_id = p_project and pm.actor_id = current_actor()
          and pm.deleted_at is null and 'manage' = any (pm.rights)))
$$;
revoke all on function may_point_agents(uuid) from public;
grant execute on function may_point_agents(uuid) to tracker_app;

/* A write with nobody signed in — a migration, the clear-out — is the
   owner's of the database. */
create function file_for_agents_is_the_runners() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.for_agents is distinct from old.for_agents
     and current_actor() is not null
     and not may_point_agents(old.project_id) then
    raise exception 'Not yours to say what agents read here.' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function file_for_agents_is_the_runners() from public;

create trigger file_for_agents_is_the_runners
  before update of for_agents on file
  for each row execute function file_for_agents_is_the_runners();
