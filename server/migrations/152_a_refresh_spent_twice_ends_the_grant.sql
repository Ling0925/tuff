/*
 * A refresh token used twice ends the connection it came from,
 * RFC 9700 §4.14.2.
 *
 * A refresh is spent by using it, and a spent one simply stopped working.
 * So a stolen one used first kept the thief's chain alive for its ninety
 * days, and the agent it was stolen from was told `invalid_grant`,
 * connected again, and nobody noticed. The tokens one connection makes
 * are tied together now (`oauth_grant`), the refreshes it spent are kept,
 * and one presented again ends every token of that connection: the thief's
 * and the owner's both, and the owner connecting again is the one who
 * notices.
 *
 * Not within ten seconds of its spending: a client that lost the answer to
 * its refresh asks again with the same one, and that is a retry, not a
 * theft.
 */
alter table api_token add column oauth_grant uuid;
update api_token set oauth_grant = id where oauth_client_id is not null;
create index api_token_by_grant on api_token (oauth_grant) where oauth_grant is not null;

create table oauth_refresh_spent (
  hash text primary key,
  grant_id uuid not null,
  spent_at timestamptz not null default now()
);
create index oauth_refresh_spent_at on oauth_refresh_spent (spent_at);
alter table oauth_refresh_spent enable row level security;
revoke all on oauth_refresh_spent from tracker_app;

drop function oauth_token_bind(text, uuid, text);
create function oauth_token_bind(p_token_hash text, p_client uuid, p_refresh_hash text, p_grant uuid) returns void
language sql volatile security definer set search_path = public as $$
  update api_token
  set oauth_client_id = p_client, refresh_hash = p_refresh_hash, oauth_grant = p_grant,
      refresh_expires_at = now() + interval '90 days', updated_at = now()
  where token_hash = p_token_hash
$$;
grant execute on function oauth_token_bind(text, uuid, text, uuid) to tracker_app;

drop function oauth_refresh_take(text, uuid);
create function oauth_refresh_take(p_hash text, p_client uuid)
returns table (actor_id uuid, workspace_id uuid, name text, grant_id uuid)
language plpgsql volatile security definer set search_path = public as $$
declare
  t record;
begin
  update api_token a
  set revoked_at = now(), refresh_hash = null, updated_at = now()
  where a.refresh_hash = p_hash and a.oauth_client_id = p_client
    and a.refresh_expires_at > now() and a.revoked_at is null and a.deleted_at is null
  returning a.actor_id, a.workspace_id, a.name, coalesce(a.oauth_grant, a.id) as g into t;

  if found then
    insert into oauth_refresh_spent (hash, grant_id) values (p_hash, t.g) on conflict do nothing;
    delete from oauth_refresh_spent where spent_at < now() - interval '91 days';
    return query select t.actor_id, t.workspace_id, t.name, t.g;
    return;
  end if;

  /* Spent before, and not a moment ago: somebody else has it. */
  update api_token a
  set revoked_at = now(), refresh_hash = null, updated_at = now()
  from oauth_refresh_spent s
  where s.hash = p_hash and s.spent_at < now() - interval '10 seconds'
    and a.oauth_grant = s.grant_id and a.oauth_client_id = p_client and a.revoked_at is null;
end $$;
grant execute on function oauth_refresh_take(text, uuid) to tracker_app;
