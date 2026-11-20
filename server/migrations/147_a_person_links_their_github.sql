/*
 * A person's own GitHub account.
 *
 * Linked once, from Account settings, so the product knows who on GitHub
 * is who here: an issue's assignee is a person here, and what a person says
 * here is written on GitHub as them. The token GitHub gives for that is
 * sealed before it is kept (`github.ts`), and only its owner's row is
 * theirs to read — a person is one actor in every workspace they are in,
 * so the row is the person's and not a workspace's.
 */
create table github_person (
  actor_id uuid primary key references actor(id),
  github_id bigint not null,
  login text not null,
  avatar_url text,
  token_enc text,
  refresh_enc text,
  token_until timestamptz,
  refresh_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
/* One GitHub account, one person here. */
create unique index github_person_once on github_person (github_id);

alter table github_person enable row level security;
create policy gpe_self on github_person for all to tracker_app
  using (actor_id = current_actor())
  with check (actor_id = current_actor());
grant select, insert, update, delete on github_person to tracker_app;

/*
 * Whether a GitHub account is somebody's already — asked before linking it,
 * across people, so a definer; it says only yes or no.
 */
create function github_account_taken(p_github bigint, p_actor uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from github_person where github_id = p_github and actor_id <> p_actor)
$$;
grant execute on function github_account_taken(bigint, uuid) to tracker_app;
