/*
 * An agent renamed, and given a new token that ends the old one.
 *
 * Both are managing it, as its face is (migration 180): the owner, or
 * whoever connected it, and never an agent. Through definers because the
 * actor table lets a person write only their own row, and a token row only
 * its own actor's.
 */
create function agent_may_be_managed(p_agent uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select current_workspace() is not null
    and not exists (select 1 from agent d where d.actor_id = current_actor())
    and exists (
      select 1 from agent g where g.actor_id = p_agent and g.workspace_id = current_workspace() and g.deleted_at is null
        and (g.created_by = current_actor() or exists (
          select 1 from membership m
          where m.workspace_id = current_workspace() and m.actor_id = current_actor()
            and m.role = 'owner' and m.deleted_at is null)))
$$;
revoke all on function agent_may_be_managed(uuid) from public;

create function agent_rename(p_agent uuid, p_name text) returns boolean
language plpgsql volatile security definer set search_path = public as $$
begin
  if not agent_may_be_managed(p_agent) or length(btrim(p_name)) = 0 then
    return false;
  end if;
  update actor set name = btrim(p_name), updated_at = now() where id = p_agent;
  return true;
end $$;
grant execute on function agent_rename(uuid, text) to tracker_app;

/* Every token it holds, ended at once: the new one is issued after this,
   by the same request. */
create function agent_end_tokens(p_agent uuid) returns boolean
language plpgsql volatile security definer set search_path = public as $$
begin
  if not agent_may_be_managed(p_agent) then
    return false;
  end if;
  update api_token set revoked_at = now(), refresh_hash = null, updated_at = now()
  where workspace_id = current_workspace() and actor_id = p_agent and revoked_at is null;
  return true;
end $$;
grant execute on function agent_end_tokens(uuid) to tracker_app;
