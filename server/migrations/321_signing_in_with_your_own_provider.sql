/*
 * Signing in through a server's own OpenID Connect provider.
 *
 * One provider for the whole server, set in its environment, so a fourth
 * name is all the table needs: `oidc`. Its subject is `<issuer> <sub>`,
 * the issuer in it so that a server moving to another provider never hands
 * an old account to whoever the new one gives the same `sub`.
 * `auth_identity_link` and `auth_identity_actor` take any provider the
 * constraint allows, and a reset forgets it with the rest.
 */
alter table auth_identity drop constraint auth_identity_provider_check;
alter table auth_identity add constraint auth_identity_provider_check
  check (provider in ('google', 'apple', 'github', 'oidc'));

/*
 * An account made through the provider on an address it does not vouch
 * for (no `email_verified: true`) is made, and its address is a weak
 * proof — `email_by_hand`, as an invitation's link handed over is
 * (migration 210). The provider may let anybody write any address on
 * their account there; made confirmed outright, an account at somebody's
 * gmail.com address was the attacker's, and when its real owner came
 * through Google, `auth_claim_email` found it confirmed and let them in
 * beside the attacker (the review of this migration). Weak, a real proof
 * — Google or Apple owning the address, this provider vouching for it
 * later, a mailed reset, a mailed change of address — takes it and puts
 * whoever made it out (`auth_claim_email`, `put_out`); and
 * `instance_add_owner`, `transfer_workspace` and `can()` refuse it as they
 * refuse a handed link's.
 *
 * Only for an account made in this very transaction — the one the
 * sign-in just made with `register_owner` or `accept_invite` — so the
 * function is no way to weaken anybody else's. The sign-in role's alone.
 */
create function auth_email_weak(p_actor uuid) returns boolean
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  update app_user u set email_by_hand = true, updated_at = now()
  where u.actor_id = p_actor and u.email_verified_at is not null and not u.email_by_hand
    and exists (select 1 from actor a where a.id = p_actor and a.created_at = now());
  return found;
end $$;
revoke all on function auth_email_weak(uuid) from public;
grant execute on function auth_email_weak(uuid) to tracker_auth;

/*
 * A change of address forgets the provider's sign-in made under the old
 * address, as it forgets Google's (151): a company's own provider is a
 * company's inbox, and whoever the company gives the old account to next
 * must not be signed into a person who has moved their account elsewhere.
 * Apple's and GitHub's stay — those accounts are the person's own.
 */
create or replace function auth_identity_forget(p_actor uuid, p_old citext) returns void
language sql volatile security definer set search_path = public, pg_temp as $$
  delete from auth_identity
  where actor_id = p_actor
    and (p_old is null
         or (provider = 'google'
             and (email is null or email = p_old)
             and split_part(p_old::text, '@', 2) not in ('gmail.com', 'googlemail.com'))
         or (provider = 'oidc' and (email is null or email = p_old)))
$$;
