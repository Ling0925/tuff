/*
 * A workspace made by somebody who is already here.
 *
 * Through a security definer function for the same reason `register_owner`
 * is: row-level security wants a membership before it lets anything in, and
 * the membership is what this is making.
 *
 * The slug is chosen here, in the same transaction as the insert, so two
 * people naming a workspace "Studio" at the same moment cannot both be told
 * `studio` is free. The unique index still has the last word; the loop only
 * saves asking it twice in the ordinary case.
 */
create function new_workspace(p_actor uuid, p_workspace uuid, p_name text)
returns citext
language plpgsql security definer set search_path = public as $$
declare
  base text := coalesce(slugify(p_name), 'workspace');
  candidate citext := base;
  n int := 1;
begin
  /* Somebody who exists and has not been removed: a definer function that
     took any uuid would make an owner out of a row nobody can sign in as. */
  if not exists (select 1 from actor where id = p_actor and deleted_at is null) then
    raise exception 'no such actor';
  end if;

  while exists (select 1 from workspace where slug = candidate) loop
    n := n + 1;
    candidate := base || '-' || n;
  end loop;

  insert into workspace (id, name, slug) values (p_workspace, p_name, candidate);
  insert into membership (id, workspace_id, actor_id, role, joined_at)
    values (gen_random_uuid(), p_workspace, p_actor, 'owner', now());
  insert into security_event (id, workspace_id, actor_id, kind)
    values (gen_random_uuid(), p_workspace, p_actor, 'workspace_created');
  perform starting_labels(p_workspace);
  return candidate;
end $$;
