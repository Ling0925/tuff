/*
 * Agents are a paid plan's.
 *
 * `can` decides it, as it decides everything, from the plan the workspace
 * is on; so who is asking now says which plan that is. The plan a gift
 * gives is the workspace's plan while it lasts, so a gifted workspace has
 * agents as a paying one does.
 */
drop function auth_context(uuid, uuid);
create function auth_context(p_actor uuid, p_workspace uuid)
returns table (role text, settings jsonb, rights json,
               may_create_projects boolean, may_create_channels boolean,
               operator boolean, plan text)
language sql stable security definer set search_path = public as $$
  select m.role::text, w.settings,
         coalesce((
           select json_agg(json_build_object('p', pm.project_id, 'r', pm.rights))
           from project_member pm
           where pm.actor_id = m.actor_id and pm.workspace_id = m.workspace_id
             and pm.deleted_at is null
         ), '[]'),
         m.may_create_projects, m.may_create_channels,
         exists (select 1 from operator o where o.actor_id = p_actor),
         w.plan
  from membership m join workspace w on w.id = m.workspace_id
  where m.actor_id = p_actor and m.workspace_id = p_workspace
    and m.deleted_at is null and m.joined_at is not null
$$;
grant execute on function auth_context(uuid, uuid) to tracker_app;
