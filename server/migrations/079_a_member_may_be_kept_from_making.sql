-- What one person may start — `docs/specs/member-rights.md`.
--
-- The workspace switch answers "may members make projects" for everybody at
-- once, and a project's rights answer "may this person open a channel here"
-- one project at a time. Neither says "not her" or "only him", which is the
-- question an owner with one new hire and one trusted lead is asking.
--
-- `may_create_projects` is null until somebody decides: null follows the
-- switch, true and false are the owner's word about this person.
-- `may_create_channels` is a ceiling over every project they are on: false
-- and no project's rights open a channel for them; true and each project
-- decides as it did.
alter table membership add column may_create_projects boolean;
alter table membership add column may_create_channels boolean not null default true;

drop function auth_context(uuid, uuid);
create function auth_context(p_actor uuid, p_workspace uuid)
returns table (role text, settings jsonb, rights json,
               may_create_projects boolean, may_create_channels boolean)
language sql stable security definer set search_path = public as $$
  select m.role::text, w.settings,
         coalesce((
           select json_agg(json_build_object('p', pm.project_id, 'r', pm.rights))
           from project_member pm
           where pm.actor_id = m.actor_id and pm.workspace_id = m.workspace_id
             and pm.deleted_at is null
         ), '[]'),
         m.may_create_projects, m.may_create_channels
  from membership m join workspace w on w.id = m.workspace_id
  where m.actor_id = p_actor and m.workspace_id = p_workspace
    and m.deleted_at is null and m.joined_at is not null
$$;

grant execute on function auth_context(uuid, uuid) to tracker_app;
