/*
 * An agent elsewhere connects by OAuth.
 *
 * ChatGPT and Claude on the web reach an MCP server only at an address and
 * only sign in through OAuth, so the server is at /mcp now and this is what
 * signs them in: a client registers, the person allows it, a one-time code
 * is traded for a token. The token is an ordinary `api_token` with the
 * client and a refresh token beside it, so everything a connected tool may
 * not do, this one may not do either.
 */

/*
 * Who asked to connect, as it named itself. Not a workspace's: one ChatGPT
 * serves everybody who adds it. Nobody reads this table but the functions
 * below.
 */
create table oauth_client (
  id uuid primary key,
  name text not null,
  redirect_uris text[] not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
alter table oauth_client enable row level security;
revoke all on oauth_client from tracker_app;

/*
 * A code handed back to the agent once the person pressed Allow: its hash,
 * who and where it is for, where it may be sent, and the PKCE challenge the
 * trade has to answer. Spent on first use, dead after ten minutes.
 */
create table oauth_code (
  code_hash text primary key,
  workspace_id uuid not null references workspace(id),
  client_id uuid not null references oauth_client(id),
  actor_id uuid not null references actor(id),
  redirect_uri text not null,
  challenge text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
alter table oauth_code enable row level security;
revoke all on oauth_code from tracker_app;
create index oauth_code_by_workspace on oauth_code (workspace_id, created_at);

/*
 * The token an agent holds is a token. These three say which client it was
 * issued to and how it is renewed; none is granted to the application
 * role's select, so a token list cannot show a refresh hash by asking.
 */
alter table api_token
  add column oauth_client_id uuid references oauth_client(id),
  add column refresh_hash text unique,
  add column refresh_expires_at timestamptz;

create function oauth_client_register(p_id uuid, p_name text, p_uris text[]) returns void
language sql volatile security definer set search_path = public as $$
  insert into oauth_client (id, name, redirect_uris) values (p_id, p_name, p_uris)
$$;

create function oauth_client_read(p_id uuid)
returns table (name text, redirect_uris text[])
language sql stable security definer set search_path = public as $$
  select c.name, c.redirect_uris from oauth_client c where c.id = p_id and c.deleted_at is null
$$;

/* Made for somebody who is a member of the workspace, and nobody else. */
create function oauth_code_make(
  p_hash text, p_workspace uuid, p_client uuid, p_actor uuid, p_uri text, p_challenge text
) returns boolean
language plpgsql volatile security definer set search_path = public as $$
begin
  if not exists (
    select 1 from membership m
    where m.workspace_id = p_workspace and m.actor_id = p_actor and m.deleted_at is null
  ) then
    return false;
  end if;
  insert into oauth_code (code_hash, workspace_id, client_id, actor_id, redirect_uri, challenge, expires_at)
  values (p_hash, p_workspace, p_client, p_actor, p_uri, p_challenge, now() + interval '10 minutes');
  return true;
end $$;

/* Spent by whoever asks first, whether or not the rest of the trade holds:
   a code tried with the wrong verifier is a code somebody else has. */
create function oauth_code_take(p_hash text)
returns table (workspace_id uuid, client_id uuid, actor_id uuid, redirect_uri text, challenge text)
language sql volatile security definer set search_path = public as $$
  update oauth_code c set used_at = now()
  where c.code_hash = p_hash and c.used_at is null and c.expires_at > now()
  returning c.workspace_id, c.client_id, c.actor_id, c.redirect_uri, c.challenge
$$;

create function oauth_token_bind(p_token_hash text, p_client uuid, p_refresh_hash text) returns void
language sql volatile security definer set search_path = public as $$
  update api_token
  set oauth_client_id = p_client, refresh_hash = p_refresh_hash,
      refresh_expires_at = now() + interval '90 days', updated_at = now()
  where token_hash = p_token_hash
$$;

/*
 * A refresh token is spent by using it: the token it renews is revoked and
 * its refresh hash cleared in the same statement, and what comes back is
 * enough to issue the next pair. A token revoked in Account has no refresh
 * left in it — that is how revoking disconnects the agent.
 */
create function oauth_refresh_take(p_hash text, p_client uuid)
returns table (actor_id uuid, workspace_id uuid, name text)
language sql volatile security definer set search_path = public as $$
  update api_token t
  set revoked_at = now(), refresh_hash = null, updated_at = now()
  where t.refresh_hash = p_hash and t.oauth_client_id = p_client
    and t.refresh_expires_at > now() and t.revoked_at is null and t.deleted_at is null
  returning t.actor_id, t.workspace_id, t.name
$$;

grant execute on function oauth_client_register(uuid, text, text[]) to tracker_app;
grant execute on function oauth_client_read(uuid) to tracker_app;
grant execute on function oauth_code_make(text, uuid, uuid, uuid, text, text) to tracker_app;
grant execute on function oauth_code_take(text) to tracker_app;
grant execute on function oauth_token_bind(text, uuid, text) to tracker_app;
grant execute on function oauth_refresh_take(text, uuid) to tracker_app;
