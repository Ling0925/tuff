/*
 * GitHub, the code half.
 *
 * An installation of the Tuff app belongs to one workspace; a repository it
 * can see is linked to one project; a pull request that names a task's
 * handle is a fact about that task. Every row carries its workspace, and the
 * project where there is one, so the policies are the ones the rest of the
 * product has: a member sees what they may see of the project, inside the
 * workspace the session is in.
 *
 * The events GitHub sends arrive before anybody is known, so their queue is
 * read and written only through the definer functions below, as the
 * webhook deliveries and Polar's are.
 */

alter type origin_kind add value if not exists 'github';

create table github_install (
  id uuid primary key,
  workspace_id uuid not null references workspace(id),
  installation_id bigint not null,
  account_login text not null,
  account_type text not null,
  installed_by uuid not null references actor(id),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
/* One workspace an installation, and one installation a workspace. */
create unique index github_install_once on github_install (installation_id) where deleted_at is null;
create unique index github_install_per_workspace on github_install (workspace_id) where deleted_at is null;
alter table github_install enable row level security;
create policy gi_in_workspace on github_install for all to tracker_app
  using (workspace_id in (select staff_workspaces())
         and (current_workspace() is null or workspace_id = current_workspace()))
  with check (workspace_id in (select staff_workspaces())
              and (current_workspace() is null or workspace_id = current_workspace()));
grant select, insert, update on github_install to tracker_app;

create table github_link (
  id uuid primary key,
  workspace_id uuid not null references workspace(id),
  project_id uuid not null references project(id),
  install_id uuid not null references github_install(id),
  repo_id bigint not null,
  repo_name text not null,
  private boolean not null,
  /* Code, or code and issues — chosen when it is linked. */
  issues boolean not null default false,
  linked_by uuid not null references actor(id),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index github_link_per_project on github_link (project_id) where deleted_at is null;
create unique index github_link_per_repo on github_link (workspace_id, repo_id) where deleted_at is null;
alter table github_link enable row level security;
create policy gl_in_project on github_link for all to tracker_app
  using (workspace_id in (select staff_workspaces())
         and (current_workspace() is null or workspace_id = current_workspace())
         and project_id in (select visible_projects()))
  with check (workspace_id in (select staff_workspaces())
              and (current_workspace() is null or workspace_id = current_workspace())
              and project_id in (select visible_projects()));
grant select, insert, update on github_link to tracker_app;

/* A pull request, as the last event about it said it stands. */
create table github_pull (
  id uuid primary key,
  workspace_id uuid not null references workspace(id),
  project_id uuid not null references project(id),
  link_id uuid not null references github_link(id),
  number int not null,
  title text not null,
  url text not null,
  author_login text,
  author_avatar text,
  head_ref text,
  head_sha text,
  state text not null check (state in ('open', 'closed', 'merged')),
  draft boolean not null default false,
  review text check (review in ('requested', 'approved', 'changes')),
  checks text check (checks in ('pending', 'success', 'failure')),
  updated_at timestamptz not null default now()
);
create unique index github_pull_once on github_pull (link_id, number);
alter table github_pull enable row level security;
create policy gp_in_project on github_pull for all to tracker_app
  using (workspace_id in (select staff_workspaces())
         and (current_workspace() is null or workspace_id = current_workspace())
         and project_id in (select visible_projects()))
  with check (workspace_id in (select staff_workspaces())
              and (current_workspace() is null or workspace_id = current_workspace())
              and project_id in (select visible_projects()));
grant select, insert, update, delete on github_pull to tracker_app;

/* Which tasks a pull request names, and whether it says it closes them. */
create table github_pull_task (
  workspace_id uuid not null references workspace(id),
  project_id uuid not null references project(id),
  pull_id uuid not null references github_pull(id) on delete cascade,
  task_id uuid not null references task(id),
  closes boolean not null default false,
  primary key (pull_id, task_id)
);
create index github_pull_by_task on github_pull_task (task_id);
alter table github_pull_task enable row level security;
create policy gpt_in_project on github_pull_task for all to tracker_app
  using (workspace_id in (select staff_workspaces())
         and (current_workspace() is null or workspace_id = current_workspace())
         and project_id in (select visible_projects()))
  with check (workspace_id in (select staff_workspaces())
              and (current_workspace() is null or workspace_id = current_workspace())
              and project_id in (select visible_projects()));
grant select, insert, update, delete on github_pull_task to tracker_app;

/* ------------------------------------------------------------ the events */

create table github_event (
  id text primary key,            -- GitHub's delivery id: the same event twice is once
  event text not null,
  installation_id bigint,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  claimed_at timestamptz,
  tries int not null default 0,
  done_at timestamptz,
  error text
);
create index github_event_waiting on github_event (received_at) where done_at is null;
alter table github_event enable row level security;

create function github_event_put(p_id text, p_event text, p_installation bigint, p_payload jsonb)
returns boolean language sql volatile security definer set search_path = public as $$
  with put as (
    insert into github_event (id, event, installation_id, payload)
    values (p_id, p_event, p_installation, p_payload)
    on conflict (id) do nothing
    returning 1
  )
  select exists (select 1 from put)
$$;
grant execute on function github_event_put(text, text, bigint, jsonb) to tracker_app;

/* The oldest waiting, claimed as they are returned so a second worker does
   not apply them twice; one claimed and never finished is taken again after
   five minutes, and given up after five tries. */
create function github_events_claim(p_n int) returns table (id text, event text, installation_id bigint, payload jsonb)
language sql volatile security definer set search_path = public as $$
  update github_event e set claimed_at = now(), tries = e.tries + 1
  where e.id in (
    select w.id from github_event w
    where w.done_at is null and w.tries < 5
      and (w.claimed_at is null or w.claimed_at < now() - interval '5 minutes')
    order by w.received_at
    limit p_n
    for update skip locked
  )
  returning e.id, e.event, e.installation_id, e.payload
$$;
grant execute on function github_events_claim(int) to tracker_app;

/* Finished, or not: an error that trying again may mend leaves it waiting
   for the next claim; any other is the end of it, kept with what it was. */
create function github_event_done(p_id text, p_error text, p_retry boolean) returns void
language sql volatile security definer set search_path = public as $$
  update github_event
  set done_at = case when p_retry then null else now() end,
      claimed_at = case when p_retry then null else claimed_at end,
      error = p_error
  where id = p_id
$$;
grant execute on function github_event_done(text, text, boolean) to tracker_app;

/* Done ones are kept a week, for whoever has to find out why. */
create function github_events_clear() returns int
language sql volatile security definer set search_path = public as $$
  with gone as (
    delete from github_event
    where (done_at is not null and done_at < now() - interval '7 days')
       or received_at < now() - interval '30 days'
    returning 1
  )
  select count(*)::int from gone
$$;
grant execute on function github_events_clear() to tracker_app;

/*
 * Where an event belongs: the workspace that has the installation, and the
 * project the repository is linked to, with whoever linked it — the person
 * the change is made as. Asked before anybody is known, so a definer.
 */
create function github_route(p_installation bigint, p_repo bigint)
returns table (workspace_id uuid, install_id uuid, link_id uuid, project_id uuid,
               project_key text, linked_by uuid, issues boolean)
language sql stable security definer set search_path = public as $$
  select i.workspace_id, i.id, l.id, l.project_id, p.key::text, l.linked_by, l.issues
  from github_install i
  left join github_link l on l.install_id = i.id and l.repo_id = p_repo and l.deleted_at is null
  left join project p on p.id = l.project_id and p.deleted_at is null
  where i.installation_id = p_installation and i.deleted_at is null
$$;
grant execute on function github_route(bigint, bigint) to tracker_app;

/* An installation removed or suspended on GitHub: its links stop. */
create function github_install_gone(p_installation bigint) returns void
language sql volatile security definer set search_path = public as $$
  update github_link set deleted_at = now()
  where deleted_at is null
    and install_id in (select id from github_install where installation_id = p_installation and deleted_at is null);
  update github_install set deleted_at = now()
  where installation_id = p_installation and deleted_at is null;
$$;
grant execute on function github_install_gone(bigint) to tracker_app;

/* A repository taken away from the installation: its link stops. */
create function github_repo_gone(p_installation bigint, p_repo bigint) returns void
language sql volatile security definer set search_path = public as $$
  update github_link set deleted_at = now()
  where deleted_at is null and repo_id = p_repo
    and install_id in (select id from github_install where installation_id = p_installation and deleted_at is null);
$$;
grant execute on function github_repo_gone(bigint, bigint) to tracker_app;
