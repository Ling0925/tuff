-- Who is asking, answered in one statement.
--
-- Every request opened a transaction to learn the caller's role, the
-- workspace's switches and what they hold on each project: begin, the two
-- settings the policies read, the query, commit. Four round trips to the
-- database before the handler's first one, on every request.
--
-- This answers the same question for an actor and a workspace that the
-- server has already verified — the claims of a signed token, or the row
-- an API token resolved to — so it needs no settings and no transaction.
-- It reads exactly what the policies would have let the actor read about
-- themselves, and nothing about anybody else.
create function auth_context(p_actor uuid, p_workspace uuid)
returns table (role text, settings jsonb, rights json)
language sql stable security definer set search_path = public as $$
  select m.role::text, w.settings,
         coalesce((
           select json_agg(json_build_object('p', pm.project_id, 'r', pm.rights))
           from project_member pm
           where pm.actor_id = m.actor_id and pm.workspace_id = m.workspace_id
             and pm.deleted_at is null
         ), '[]')
  from membership m join workspace w on w.id = m.workspace_id
  where m.actor_id = p_actor and m.workspace_id = p_workspace
    and m.deleted_at is null and m.joined_at is not null
$$;

grant execute on function auth_context(uuid, uuid) to tracker_app;
