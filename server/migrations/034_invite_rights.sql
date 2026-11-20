/*
 * An invite carries the permissions, not a category.
 *
 * Migration 033 took `restricted` off the invite along with the idea behind
 * it, and left `accept_invite` still reading it. A plpgsql body is only
 * checked when it runs, so nothing complained until somebody followed a
 * link — the one path in the product where the person on the other end has
 * no account yet and no way to report what they saw.
 *
 * What replaces it is the same list a member carries on a project. Set on
 * the invite rather than afterwards, for the reason the flag was: arriving
 * with everything and being cut down later leaves a window, and the window
 * is exactly long enough to read the whole project.
 */

alter table invite add column if not exists rights text[] not null default '{task.create,channel.create}';
grant select (rights) on invite to tracker_app;

/*
 * And the reason nobody could follow a link at all.
 *
 * Migration 003 declared this as (hash, actor, name, email, hash) and 027
 * re-declared it as (hash, actor, email, name, hash) — two of the five
 * arguments swapped. `create or replace` does not replace across a changed
 * signature: it overloads. Both have existed ever since, the endpoint sends
 * five untyped parameters, and Postgres cannot choose between them, so every
 * accept since 027 has answered `function accept_invite is not unique`.
 *
 * Dropped by signature, both of them, and declared once. The endpoint casts
 * each argument now, so the next time somebody reorders these the call fails
 * to resolve instead of quietly binding to the other one.
 */
drop function if exists accept_invite(text, uuid, text, citext, text);
drop function if exists accept_invite(text, uuid, citext, text, text);

create function accept_invite(
  p_token_hash text,
  p_actor_id uuid,
  p_name text,
  p_email citext,
  p_password_hash text
) returns table (workspace_id uuid, actor_id uuid, created_account boolean)
language plpgsql security definer set search_path = public as $$
declare
  inv     record;
  v_actor uuid;
  v_new   boolean := false;
  p       uuid;
begin
  update invite set used_at = now()
  where token_hash = p_token_hash
    and used_at is null
    and deleted_at is null
    and expires_at > now()
  returning * into inv;

  if inv is null then
    return;
  end if;

  select u.actor_id into v_actor from app_user u where u.email = p_email;

  if v_actor is null then
    v_actor := p_actor_id;
    v_new := true;
    insert into actor (id, name) values (v_actor, p_name);
    insert into app_user (actor_id, email, password_hash, email_verified_at)
      values (v_actor, p_email, p_password_hash, now());
  end if;

  insert into membership (id, workspace_id, actor_id, role, invited_by, joined_at)
  values (gen_random_uuid(), inv.workspace_id, v_actor, inv.role, inv.created_by, now())
  on conflict do nothing;

  foreach p in array inv.project_ids
  loop
    insert into project_member (id, workspace_id, project_id, actor_id, added_by, rights)
    values (gen_random_uuid(), inv.workspace_id, p, v_actor, inv.created_by, inv.rights)
    on conflict do nothing;
  end loop;

  update invite set used_by = v_actor where id = inv.id;

  insert into security_event (id, workspace_id, actor_id, kind, meta)
  values (gen_random_uuid(), inv.workspace_id, v_actor, 'invite_accepted',
          jsonb_build_object('role', inv.role, 'rights', inv.rights));

  return query select inv.workspace_id, v_actor, v_new;
end $$;
