/*
 * An agent's face.
 *
 * A person sets their own picture through `a_update`, which lets an actor
 * write only its own row. An agent never signs in to set its own, so the
 * owner or whoever connected it sets it — `agent.manage` in `can()`, asked
 * again here on the row, as disconnecting asks it (`agent_disconnect`).
 * `p_key` null takes the picture off. The bytes the old key held go with
 * it, through the trigger every picture has (`avatar_bytes_go_with_it`).
 */
create function agent_face(p_agent uuid, p_key text) returns boolean
language plpgsql volatile security definer set search_path = public as $$
declare
  ws uuid := current_workspace();
begin
  if ws is null or not exists (
    select 1 from agent g where g.actor_id = p_agent and g.workspace_id = ws and g.deleted_at is null
      and (g.created_by = current_actor() or exists (
        select 1 from membership m
        where m.workspace_id = ws and m.actor_id = current_actor() and m.role = 'owner' and m.deleted_at is null))
  ) then
    return false;
  end if;
  -- Never an agent setting one: its own, or another's.
  if exists (select 1 from agent d where d.actor_id = current_actor()) then
    return false;
  end if;
  update actor set avatar_key = p_key where id = p_agent;
  return true;
end $$;
grant execute on function agent_face(uuid, text) to tracker_app;
