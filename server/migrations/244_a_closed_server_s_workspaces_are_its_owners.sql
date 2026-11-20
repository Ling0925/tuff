/*
 * On a server of one's own with sign-up closed, a new workspace is its
 * owners' to make;
 * finding 8.
 *
 * "Sign-up closed" bounded the forms that make an account, and not the
 * other door: any member could make a workspace, own it, and invite
 * anybody, and every invitation is an account (an invited applicant's
 * confirmation is let through, migration 212). So closed sign-up bounded
 * nothing. `can()` refuses `workspace.create` there to anybody who is not
 * an instance owner; the database says the same where the workspace is
 * made, so a route that forgets cannot. Invitations into the workspaces
 * there still work, as the spec says they are how people get in.
 *
 * Otherwise 091's text. Changes no rows.
 */
create or replace function new_workspace(
  p_actor uuid, p_workspace uuid, p_name text,
  p_slug text, p_plan text, p_icon text, p_tint smallint)
returns citext
language plpgsql security definer set search_path = public as $$
declare
  candidate citext;
begin
  if not exists (select 1 from actor where id = p_actor and deleted_at is null) then
    raise exception 'no such actor';
  end if;
  /* On a server of one's own with sign-up closed, its owners alone. On
     the service `instance_sign_up_open` is always true. */
  if not instance_sign_up_open() and not exists (select 1 from instance_owner where actor_id = p_actor) then
    raise exception 'sign_up_closed' using errcode = 'P0001';
  end if;
  if p_slug is null then
    candidate := free_workspace_slug(p_name);
  else
    if not workspace_slug_allowed(lower(p_slug)) then
      raise exception 'slug_invalid' using errcode = 'P0001';
    end if;
    if exists (select 1 from workspace where slug = p_slug::citext) then
      raise exception 'slug_taken' using errcode = 'P0001';
    end if;
    candidate := lower(p_slug);
  end if;

  insert into workspace (id, name, slug, plan, mark_icon, mark_tint)
    values (p_workspace, p_name, candidate, coalesce(p_plan, 'solo'), p_icon, p_tint);
  insert into membership (id, workspace_id, actor_id, role, joined_at)
    values (gen_random_uuid(), p_workspace, p_actor, 'owner', now());
  insert into security_event (id, workspace_id, actor_id, kind)
    values (gen_random_uuid(), p_workspace, p_actor, 'workspace_created');
  perform starting_labels(p_workspace);
  return candidate;
end $$;

