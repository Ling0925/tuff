/*
 * Every agent is somebody's agent, and only that person manages it — by decision, after the review of.
 *
 * Managing it was the owner's or its connector's (migration 264). The owner
 * could give somebody else's agent a new token, sign Tuff's connector in as
 * it, point its webhook at another address, rename it — and so read, as the
 * agent, a document its connector's colleague had chosen it for, behind a
 * second line in the panel that named only the connector. Now each of those
 * is the connector's alone:
 *
 * - `agent_may_be_managed` — a new token, a name, the webhook's key and
 *   shape, how it is reached, what its webhook says (264, 266, 268);
 * - `oauth_agent_managed` — signing the connector in as it (269);
 * - `agent_face` — its picture (180), which asked the old rule itself.
 *
 * What takes access away stays the owner's too, because it hands nothing
 * over: disconnecting it (`agent_disconnect`, unchanged), taking it off a
 * project (a project's own rights, unchanged), and ending a connection
 * Tuff's connector made as it — for which the owner also sees that list
 * (`agent_may_be_removed`, below).
 *
 * A connection the owner linked as somebody else's agent before this now
 * fails `oauth_agent_managed`. The trigger of 269 ends such a grant the next
 * time the owner's membership row changes; this migration does not end them
 * itself, because ending tokens is rewriting rows, and those run first on a
 * copy of production.
 *
 * Changes no rows.
 */

create or replace function agent_may_be_managed(p_agent uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select current_workspace() is not null
    and not exists (select 1 from agent d where d.actor_id = current_actor())
    and exists (
      select 1 from agent g
      where g.actor_id = p_agent and g.workspace_id = current_workspace() and g.deleted_at is null
        and g.created_by = current_actor())
$$;

/* Disconnecting it, or ending what was signed in as it: the owner, or
   whoever connected it, never an agent. Taking away hands nothing over. */
create function agent_may_be_removed(p_agent uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select current_workspace() is not null
    and not exists (select 1 from agent d where d.actor_id = current_actor())
    and exists (
      select 1 from agent g
      where g.actor_id = p_agent and g.workspace_id = current_workspace() and g.deleted_at is null
        and (g.created_by = current_actor() or exists (
          select 1 from membership m
          where m.workspace_id = current_workspace() and m.actor_id = current_actor()
            and m.role = 'owner' and m.deleted_at is null)))
$$;
revoke all on function agent_may_be_removed(uuid) from public;

/* The row half of `agent.manage`, for the paths with no session: its
   connector, still in the workspace. */
create or replace function oauth_agent_managed(p_agent uuid, p_workspace uuid, p_person uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select not exists (select 1 from agent d where d.actor_id = p_person)
    and exists (
      select 1 from agent g where g.actor_id = p_agent and g.workspace_id = p_workspace and g.deleted_at is null
        and g.created_by = p_person
        and exists (select 1 from membership a where a.workspace_id = p_workspace and a.actor_id = p_agent and a.deleted_at is null)
        and exists (
          select 1 from membership m
          where m.workspace_id = p_workspace and m.actor_id = p_person and m.deleted_at is null))
$$;

create or replace function agent_face(p_agent uuid, p_key text) returns boolean
language plpgsql volatile security definer set search_path = public as $$
begin
  if not agent_may_be_managed(p_agent) then
    return false;
  end if;
  update actor set avatar_key = p_key where id = p_agent;
  return true;
end $$;

/* The connections made as it, to whoever may end them. */
create or replace function agent_oauth_connections(p_agent uuid)
returns table (id uuid, client text, created_at timestamptz, linked_by uuid, linked_by_name text)
language sql stable security definer set search_path = public, pg_temp as $$
  select g.id, c.name, g.created_at, g.linked_by, b.name
  from oauth_agent_grant g
  join oauth_client c on c.id = g.client_id
  join actor b on b.id = g.linked_by
  where agent_may_be_removed(p_agent)
    and g.agent_id = p_agent and g.workspace_id = current_workspace()
    and exists (
      select 1 from api_token t
      where t.oauth_grant = g.id and t.actor_id = p_agent and t.revoked_at is null and t.deleted_at is null
        and (t.expires_at > now() or t.refresh_expires_at > now()))
  order by g.created_at desc
$$;

create or replace function agent_oauth_end(p_agent uuid, p_grant uuid) returns text
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  named text;
begin
  if not agent_may_be_removed(p_agent) then
    return null;
  end if;
  select c.name into named
  from oauth_agent_grant g join oauth_client c on c.id = g.client_id
  where g.id = p_grant and g.agent_id = p_agent and g.workspace_id = current_workspace();
  if named is null then
    return null;
  end if;
  update api_token set revoked_at = now(), refresh_hash = null, updated_at = now()
  where workspace_id = current_workspace() and actor_id = p_agent and oauth_grant = p_grant and revoked_at is null;
  return named;
end $$;
