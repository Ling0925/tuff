/*
 * A workspace starts with a few words.
 *
 * An empty picker teaches nothing: somebody opens it, finds nothing, and
 * either invents a label nobody else will reuse or decides labels are not for
 * them. Three is enough to say what the thing is for and few enough that
 * nobody inherits a vocabulary they did not choose.
 *
 * Not a setting and not a template: they are ordinary rows, so the first
 * person who disagrees can take one away.
 */
create function starting_labels(p_workspace_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into label (id, workspace_id, name)
  select gen_random_uuid(), p_workspace_id, name
  from (values ('bug'), ('question'), ('client')) as starting(name)
  on conflict (workspace_id, name) where deleted_at is null do nothing;
end $$;

/* Made with the workspace, in the one statement that makes everything else a
   workspace needs to exist at all. */
create or replace function register_owner(
  p_actor_id      uuid,
  p_name          text,
  p_email         citext,
  p_password_hash text,
  p_workspace_id  uuid,
  p_ws_name       text,
  p_ws_slug       citext
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into actor (id, name) values (p_actor_id, p_name);
  insert into app_user (actor_id, email, password_hash, email_verified_at)
    values (p_actor_id, p_email, p_password_hash, now());
  insert into workspace (id, name, slug) values (p_workspace_id, p_ws_name, p_ws_slug);
  insert into membership (id, workspace_id, actor_id, role, joined_at)
    values (gen_random_uuid(), p_workspace_id, p_actor_id, 'owner', now());
  insert into security_event (id, workspace_id, actor_id, kind)
    values (gen_random_uuid(), p_workspace_id, p_actor_id, 'register');
  perform starting_labels(p_workspace_id);
end $$;

/* And the workspaces that already exist, which are every one made before
   today. A word nobody uses costs a row; a workspace that never learns what
   labels are for costs the feature. */
do $$
declare w record;
begin
  for w in select id from workspace loop
    perform starting_labels(w.id);
  end loop;
end $$;
