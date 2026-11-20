/*
 * Two more things the owner says about one person — `docs/specs/member-rights.md`.
 *
 * Whether they may open the Members screen, and whether they may invite
 * people in. Null until the owner says something: then the workspace's
 * switch decides — `who_sees_members`, `who_invites_people` — as before.
 * True or false is the owner's word about this person and wins over the
 * switch either way: the shape `may_create_projects` has, because each has
 * one workspace-wide default to override.
 */
alter table membership add column may_see_members boolean;
alter table membership add column may_invite_people boolean;

/* Answered with the role, as the two before them are, so `can()` reads them
   on every path — web, MCP and `/api/me` — without a second query. */
drop function auth_context(uuid, uuid);
create function auth_context(p_actor uuid, p_workspace uuid)
returns table (role text, settings jsonb, rights json,
               may_create_projects boolean, may_create_channels boolean,
               operator boolean, plan text,
               may_see_members boolean, may_invite_people boolean)
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
         w.plan,
         m.may_see_members, m.may_invite_people
  from membership m join workspace w on w.id = m.workspace_id
  where m.actor_id = p_actor and m.workspace_id = p_workspace
    and m.deleted_at is null and m.joined_at is not null
$$;
grant execute on function auth_context(uuid, uuid) to tracker_app;
