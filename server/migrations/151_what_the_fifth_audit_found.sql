/*
 * The fifth audit.
 *
 * A Google or Apple sign-in stayed with an account through a change of
 * address and a password reset. Somebody who left a company and moved
 * their Tuff account to a personal address could still be signed into by
 * whoever the company gave the old Google account to next — the exact case
 * the address change says it closes, "a company's inbox stays the
 * company's".
 *
 * On a change of address, a Google sign-in made under the old address
 * goes, unless the old address is Google's own (gmail.com, googlemail.com),
 * which no company can hand to somebody else. On a reset, every provider
 * sign-in goes: a reset is how somebody shuts a door they think is open,
 * and a provider that vouches for the address links it again on the next
 * sign-in.
 */
create function auth_identity_forget(p_actor uuid, p_old citext) returns void
language sql volatile security definer set search_path = public as $$
  delete from auth_identity
  where actor_id = p_actor
    and (p_old is null
         or (provider = 'google'
             and (email is null or email = p_old)
             and split_part(p_old::text, '@', 2) not in ('gmail.com', 'googlemail.com')))
$$;
grant execute on function auth_identity_forget(uuid, citext) to tracker_app;

/*
 * An account deleted kept its GitHub: the sealed token and its refresh,
 * which could go on editing the person's old comments on GitHub, and the
 * GitHub account itself, which no other account could then link. Deletion
 * removes the person's `app_user` row; their GitHub goes with it.
 */
create function github_person_goes() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from github_person where actor_id = old.actor_id;
  return old;
end
$$;
create trigger app_user_takes_github after delete on app_user
  for each row execute function github_person_goes();
