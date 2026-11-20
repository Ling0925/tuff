/*
 * Tuff's remote MCP connector signs in as an agent.
 *
 * The OAuth page only ever made the person's own token, so a Claude Code
 * routine, a claude.ai connector or Grok connected that way worked with
 * every right and every project of whoever pressed Allow, and what it
 * wrote went under their name. Now the page asks who it signs in as —
 * the person, or an agent they manage — and the code it makes carries the
 * agent. The tokens traded for it are the agent's (`actor_id` the agent),
 * so its places and its ceiling bound them as they bound the token its
 * page shows, and ending the agent's tokens ends these too: `agent_end`
 * and `agent_end_tokens` already revoke every token whose actor is the
 * agent, refresh and all.
 *
 * `oauth_code.actor_id` stays the person who pressed Allow; `agent_id` is
 * whom the token is for. `oauth_agent_grant` remembers, per connection,
 * which client was linked to which agent, by whom and when — what the
 * agent's page lists, and what the trade and every refresh ask again
 * (the person who linked it must still manage it). Nobody reads it but
 * the functions below.
 */
alter table oauth_code add column agent_id uuid references actor(id);

create table oauth_agent_grant (
  id uuid primary key,
  workspace_id uuid not null references workspace(id),
  agent_id uuid not null references actor(id),
  client_id uuid not null references oauth_client(id),
  linked_by uuid not null references actor(id),
  created_at timestamptz not null default now()
);
alter table oauth_agent_grant enable row level security;
revoke all on oauth_agent_grant from tracker_app;
create index oauth_agent_grant_by_agent on oauth_agent_grant (workspace_id, agent_id, created_at);

/*
 * The code, as before, and for an agent when one is named: a live agent of
 * this workspace that the person may manage — the owner, or whoever
 * connected it, as `agent_may_be_managed` says for a session. Asked here on
 * the rows because this runs with no session set. Null by default, so a
 * server still calling it with six arguments makes the person's code.
 */
drop function oauth_code_make(text, uuid, uuid, uuid, text, text);
create function oauth_code_make(
  p_hash text, p_workspace uuid, p_client uuid, p_actor uuid, p_uri text, p_challenge text, p_agent uuid default null
) returns boolean
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  if not exists (
    select 1 from membership m
    where m.workspace_id = p_workspace and m.actor_id = p_actor and m.deleted_at is null
  ) then
    return false;
  end if;
  if p_agent is not null and not oauth_agent_managed(p_agent, p_workspace, p_actor) then
    return false;
  end if;
  insert into oauth_code (code_hash, workspace_id, client_id, actor_id, redirect_uri, challenge, expires_at, agent_id)
  values (p_hash, p_workspace, p_client, p_actor, p_uri, p_challenge, now() + interval '10 minutes', p_agent);
  return true;
end $$;

/* Whether this person manages this live agent of this workspace — the row
   half of `agent.manage`, for the paths with no session. */
create function oauth_agent_managed(p_agent uuid, p_workspace uuid, p_person uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select not exists (select 1 from agent d where d.actor_id = p_person)
    and exists (
      select 1 from agent g where g.actor_id = p_agent and g.workspace_id = p_workspace and g.deleted_at is null
        and exists (select 1 from membership a where a.workspace_id = p_workspace and a.actor_id = p_agent and a.deleted_at is null)
        and exists (
          select 1 from membership m
          where m.workspace_id = p_workspace and m.actor_id = p_person and m.deleted_at is null
            and (m.role = 'owner' or (m.role = 'member' and g.created_by = p_person))))
$$;
revoke all on function oauth_agent_managed(uuid, uuid, uuid) from public;

drop function oauth_code_take(text);
create function oauth_code_take(p_hash text)
returns table (workspace_id uuid, client_id uuid, actor_id uuid, redirect_uri text, challenge text, agent_id uuid)
language sql volatile security definer set search_path = public, pg_temp as $$
  update oauth_code c set used_at = now()
  where c.code_hash = p_hash and c.used_at is null and c.expires_at > now()
  returning c.workspace_id, c.client_id, c.actor_id, c.redirect_uri, c.challenge, c.agent_id
$$;

/* A connection made for an agent, remembered once, at the trade. */
create function oauth_agent_link(p_grant uuid, p_workspace uuid, p_agent uuid, p_client uuid, p_by uuid) returns void
language sql volatile security definer set search_path = public, pg_temp as $$
  insert into oauth_agent_grant (id, workspace_id, agent_id, client_id, linked_by)
  values (p_grant, p_workspace, p_agent, p_client, p_by)
  on conflict (id) do nothing
$$;

/* Who linked the connection a refresh belongs to, when it is an agent's —
   nulls for a person's own — and whether the token's actor is an agent,
   so an agent's refresh with no link is refused rather than renewed. Not bound to a workspace: it runs before
   anybody is known (the refresh token is the only proof), is granted to
   the application role alone, and answers two ids for a grant id that is
   itself a secret's sibling — the caller still asks `can()` with them. */
create function oauth_agent_linked_by(p_grant uuid, p_actor uuid)
returns table (agent_id uuid, linked_by uuid, actor_is_agent boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select g.agent_id, g.linked_by, exists (select 1 from agent a where a.actor_id = p_actor)
  from (select 1) one
  left join oauth_agent_grant g on g.id = p_grant
$$;

/*
 * The connections an agent holds this way and that still live, for its
 * page — to whoever manages it, and to nobody else.
 */
create function agent_oauth_connections(p_agent uuid)
returns table (id uuid, client text, created_at timestamptz, linked_by uuid, linked_by_name text)
language sql stable security definer set search_path = public, pg_temp as $$
  select g.id, c.name, g.created_at, g.linked_by, b.name
  from oauth_agent_grant g
  join oauth_client c on c.id = g.client_id
  join actor b on b.id = g.linked_by
  where agent_may_be_managed(p_agent)
    and g.agent_id = p_agent and g.workspace_id = current_workspace()
    and exists (
      select 1 from api_token t
      where t.oauth_grant = g.id and t.actor_id = p_agent and t.revoked_at is null and t.deleted_at is null
        and (t.expires_at > now() or t.refresh_expires_at > now()))
  order by g.created_at desc
$$;

/* One of them ended: every token of that connection, refresh and all. The
   client's name, for the audit line; nothing when it was not there. */
create function agent_oauth_end(p_agent uuid, p_grant uuid) returns text
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  named text;
begin
  if not agent_may_be_managed(p_agent) then
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

/*
 * A new token ends every one it held (migration 264) — and a code made for
 * it and not yet traded, which would otherwise become a token after the
 * press that was meant to end them all.
 */
create or replace function agent_end_tokens(p_agent uuid) returns boolean
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  if not agent_may_be_managed(p_agent) then
    return false;
  end if;
  update api_token set revoked_at = now(), refresh_hash = null, updated_at = now()
  where workspace_id = current_workspace() and actor_id = p_agent and revoked_at is null;
  update oauth_code set used_at = now()
  where workspace_id = current_workspace() and agent_id = p_agent and used_at is null;
  return true;
end $$;

grant execute on function oauth_code_make(text, uuid, uuid, uuid, text, text, uuid) to tracker_app;
grant execute on function oauth_code_take(text) to tracker_app;
grant execute on function oauth_agent_link(uuid, uuid, uuid, uuid, uuid) to tracker_app;
grant execute on function oauth_agent_linked_by(uuid, uuid) to tracker_app;
grant execute on function agent_oauth_connections(uuid) to tracker_app;
grant execute on function agent_oauth_end(uuid, uuid) to tracker_app;

/*
 * Whoever linked a connection and stops managing the agent ends it at
 * once — removed from the workspace (`remove_from_workspace`), an owner
 * who handed the workspace over (`transfer_workspace`), or the agent
 * handed to somebody else. Asked on the rows that change rather than in
 * each path that changes them: a trigger cannot be forgotten by the next
 * one. Without it the agent kept working until its next refresh, up to
 * the seven days an access token lives. The agent's other tokens, and
 * connections somebody who still manages it linked, stay.
 */
create function oauth_agent_linker_check(p_workspace uuid, p_person uuid, p_agent uuid) returns void
language sql volatile security definer set search_path = public, pg_temp as $$
  update api_token t set revoked_at = now(), refresh_hash = null, updated_at = now()
  from oauth_agent_grant g
  where g.workspace_id = p_workspace
    and (p_person is null or g.linked_by = p_person)
    and (p_agent is null or g.agent_id = p_agent)
    and t.oauth_grant = g.id and t.actor_id = g.agent_id and t.workspace_id = g.workspace_id
    and t.revoked_at is null
    and not oauth_agent_managed(g.agent_id, g.workspace_id, g.linked_by)
$$;
revoke all on function oauth_agent_linker_check(uuid, uuid, uuid) from public;

create function oauth_agent_membership_changed() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform oauth_agent_linker_check(new.workspace_id, new.actor_id, null);
  return null;
end $$;
create trigger oauth_agent_membership_changed after update of role, deleted_at on membership
  for each row when (old.role is distinct from new.role or old.deleted_at is distinct from new.deleted_at)
  execute function oauth_agent_membership_changed();

create function oauth_agent_handed() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform oauth_agent_linker_check(new.workspace_id, null, new.actor_id);
  return null;
end $$;
create trigger oauth_agent_handed after update of created_by on agent
  for each row when (old.created_by is distinct from new.created_by)
  execute function oauth_agent_handed();
