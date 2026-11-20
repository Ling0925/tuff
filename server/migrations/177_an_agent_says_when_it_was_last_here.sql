/*
 * When each agent last came to Tuff.
 * A task an agent has moved into progress shows it working while it keeps
 * coming; one that went quiet does not go on showing it for ever.
 *
 * The moment is its token's last use, and tokens are read by their owner
 * and the workspace's owner only (`tok_own`): a member reading the Agents
 * tab was told every agent had never been active. This answers that one
 * moment, for the agents of the workspace the caller is in, and nothing
 * else of the token.
 */
create function agents_last_here()
returns table (actor_id uuid, active_at timestamptz)
language sql stable security definer set search_path = public as $$
  select g.actor_id, max(t.last_used_at)
  from agent g
  join api_token t on t.actor_id = g.actor_id and t.revoked_at is null
  where g.workspace_id = current_workspace() and g.deleted_at is null
    and is_member(current_workspace())
  group by g.actor_id
$$;
revoke execute on function agents_last_here() from public;
grant execute on function agents_last_here() to tracker_app;
