/*
 * Signing in with GitHub.
 *
 * A GitHub account is somebody here only when it made the account. Never
 * by a matching address — GitHub is not the authority for anybody's email
 * — and not by connecting GitHub in Account settings, which is about what
 * Tuff may do on GitHub, not a way into the account.
 */

alter table auth_identity drop constraint auth_identity_provider_check;
alter table auth_identity add constraint auth_identity_provider_check
  check (provider in ('google', 'apple', 'github'));

/* One GitHub account, one person: connecting one in Account settings that
   signs somebody else in is refused, as one connected to somebody else
   already is. */
create or replace function github_account_taken(p_github bigint, p_actor uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from github_person where github_id = p_github and actor_id <> p_actor)
      or exists (select 1 from auth_identity
                 where provider = 'github' and subject = p_github::text and actor_id <> p_actor)
$$;
