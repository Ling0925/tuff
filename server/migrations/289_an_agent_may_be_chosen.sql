/*
 * An agent on the project may be one of a document's chosen people, by decision.
 * This takes back point 4 of migration 284.
 *
 * An agent has a membership (`agent_connect`, migration 176) and a place on
 * its projects, so the rule a person is asked holds it as it is: of the
 * workspace now, and on the project. A disconnected agent's membership and
 * places end with it (`agent_end`), and the triggers of migration 279 take
 * its rows on documents with them, as for a person. Asked here as well, so
 * an agent row ended a moment before its membership is not chosen.
 *
 * A project's feedback page, on its list only to file requests, is never
 * chosen: the project's list of people leaves it out too.
 *
 * Choosing stays a person's: `file.share` is never an agent's and never a
 * token's (`can()`), and the insert policy asks it (`may_share_file`).
 *
 * Changes no rows.
 */

create or replace function chosen_may_be(p_file uuid, p_actor uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from file f
    join membership m on m.workspace_id = f.workspace_id and m.actor_id = p_actor
      and m.deleted_at is null and m.joined_at is not null
    where f.id = p_file
      and (current_workspace() is null or f.workspace_id = current_workspace())
      and not exists (select 1 from agent g where g.actor_id = p_actor and g.deleted_at is not null)
      /* A project's feedback page is on it only to file requests. */
      and not page_actor(p_actor)
      and (m.role = 'owner' or exists (
        select 1 from project_member pm
        where pm.project_id = f.project_id and pm.actor_id = p_actor and pm.deleted_at is null))
  )
$$;
