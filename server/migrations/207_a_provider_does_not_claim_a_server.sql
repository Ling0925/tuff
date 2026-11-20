/*
 * A provider does not claim a server nobody owns — a review.
 *
 * 202 let the first account a provider vouched for own an unclaimed
 * server: Google, Apple or GitHub confirm the address as the account is
 * made, so `register_owner` named it owner on the spot. But a server's
 * name is public within minutes of its certificate (Certificate
 * Transparency logs every one), and anybody with a Google account could
 * reach a fresh server before its admin and own it — with no mail set up,
 * before the admin could even confirm an address.
 *
 * So on a server of one's own that nobody has claimed:
 *
 * - `register_owner`, asked for an account already confirmed (a
 *   provider's), refuses it with `sign_up_closed` and makes nothing;
 * - `auth_claim_email` — a provider vouching for the address of an
 *   account that signed up by email and never confirmed — refuses too,
 *   since the trigger would make that account the owner.
 *
 * What claims the server is the confirmation link mailed to the address,
 * or the machine (`instance_name_owner`, 205 and 206). Once it is claimed
 * nothing here changes: a provider makes an account while the owner has
 * sign-up open, and with an invitation, as before.
 *
 * Nothing changes on the service, whose settings row never says
 * `community`.
 */
create or replace function register_owner(
  p_actor_id      uuid,
  p_name          text,
  p_email         citext,
  p_password_hash text,
  p_workspace_id  uuid,
  p_ws_name       text,
  p_ws_slug       citext,
  p_confirmed     boolean default true,
  p_asked         boolean default true
) returns void
language plpgsql security definer set search_path = public as $$
declare s instance_setting;
begin
  select * into s from instance_setting where id;
  if s.community then
    select * into s from instance_setting where id for update;
    if p_asked and s.claimed_at is not null and not s.sign_up_open then
      raise exception 'sign_up_closed';
    end if;
    if p_asked and p_confirmed and s.claimed_at is null then
      raise exception 'sign_up_closed';
    end if;
  end if;

  insert into actor (id, name) values (p_actor_id, p_name);
  insert into app_user (actor_id, email, password_hash, email_verified_at)
    values (p_actor_id, p_email, p_password_hash, case when p_confirmed then now() end);
  insert into workspace (id, name, slug) values (p_workspace_id, p_ws_name, p_ws_slug);
  insert into membership (id, workspace_id, actor_id, role, joined_at)
    values (gen_random_uuid(), p_workspace_id, p_actor_id, 'owner', now());
  insert into security_event (id, workspace_id, actor_id, kind)
    values (gen_random_uuid(), p_workspace_id, p_actor_id, 'register');
  perform starting_labels(p_workspace_id);

  if s.community and p_asked and not p_confirmed then
    insert into instance_applicant (actor_id) values (p_actor_id);
  end if;
end $$;

create or replace function auth_claim_email(p_actor uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from instance_setting where id and community and claimed_at is null)
     and exists (select 1 from instance_applicant where actor_id = p_actor) then
    raise exception 'sign_up_closed';
  end if;
  if exists (select 1 from app_user where actor_id = p_actor and email_verified_at is null) then
    update app_user set email_verified_at = now(), password_hash = null,
                        totp_enabled = false, totp_secret_enc = null, updated_at = now()
    where actor_id = p_actor;
    delete from recovery_code where actor_id = p_actor;
    update refresh_session set revoked_at = coalesce(revoked_at, now()), ended_at = now()
    where actor_id = p_actor and ended_at is null;
    update api_token set revoked_at = now() where actor_id = p_actor and revoked_at is null;
    delete from push_subscription where actor_id = p_actor;
  end if;
end $$;
