-- Registration and joining both create an actor before any membership exists,
-- which is precisely the state RLS refuses. Both run as the table owner, in
-- one statement, so there is no window in which a half-made account is live.

create function register_owner(
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
end $$;

/*
 * Following an invite link.
 *
 * Single use and expiry are settled inside one conditional update rather than a
 * check followed by a write: two people racing on the same link produce one
 * membership, not two.
 *
 * A client's link carries the projects it opens. It never opens the workspace.
 */
create function accept_invite(
  p_token_hash    text,
  p_actor_id      uuid,
  p_name          text,
  p_email         citext,
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
    insert into project_member (id, workspace_id, project_id, actor_id, added_by)
    values (gen_random_uuid(), inv.workspace_id, p, v_actor, inv.created_by)
    on conflict do nothing;
  end loop;

  update invite set used_by = v_actor where id = inv.id;

  insert into security_event (id, workspace_id, actor_id, kind, meta)
  values (gen_random_uuid(), inv.workspace_id, v_actor, 'invite_accepted',
          jsonb_build_object('role', inv.role));

  return query select inv.workspace_id, v_actor, v_new;
end $$;

/* What the link says before anyone types a password. */
create function preview_invite(p_token_hash text)
returns table (workspace_name text, role role_kind, email citext, state text)
language sql stable security definer set search_path = public as $$
  select w.name, i.role, i.email,
         case
           when i.deleted_at is not null then 'revoked'
           when i.used_at is not null then 'used'
           when i.expires_at <= now() then 'expired'
           else 'open'
         end
  from invite i join workspace w on w.id = i.workspace_id
  where i.token_hash = p_token_hash
$$;

create function auth_lookup_user(p_email citext)
returns table (actor_id uuid, password_hash text, totp_enabled boolean)
language sql stable security definer set search_path = public as $$
  select u.actor_id, u.password_hash, u.totp_enabled from app_user u where u.email = p_email
$$;

create function auth_lookup_refresh(p_hash text)
returns table (session_id uuid, actor_id uuid)
language sql stable security definer set search_path = public as $$
  select s.id, s.actor_id from refresh_session s
  where s.token_hash = p_hash and s.revoked_at is null and s.expires_at > now()
$$;

/* The interface shows when a token was last used, so it is stamped here. */
create function auth_lookup_api_token(p_hash text)
returns table (actor_id uuid, workspace_id uuid, token_id uuid, project_ids uuid[])
language plpgsql security definer set search_path = public as $$
begin
  return query
    update api_token t
    set last_used_at = now()
    where t.token_hash = p_hash
      and t.revoked_at is null
      and t.expires_at > now()
      and t.deleted_at is null
    returning t.actor_id, t.workspace_id, t.id, t.project_ids;
end $$;

grant execute on all functions in schema public to tracker_app;
