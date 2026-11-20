/*
 * GitHub, the issues half.
 *
 * With Code and issues, every issue of the repository and every top-level
 * task of the project are one row, written on either side and kept the same
 * on the other. `github_issue` is the pairing and what was last seen of each
 * field on GitHub's side, so a change is told from an echo of our own;
 * `github_comment` pairs comments the same way; `github_out` is the queue of
 * what was changed here and is owed to GitHub, drained by the worker in the
 * order it was made.
 */

create table github_issue (
  workspace_id uuid not null references workspace(id),
  project_id uuid not null references project(id),
  link_id uuid not null references github_link(id),
  task_id uuid not null references task(id),
  number int not null,
  /* What GitHub last said, field by field: title, body, state, reason,
     assignees (logins), labels (names). */
  seen jsonb not null default '{}',
  /* The list a task left when its issue closed, to go back to on reopening. */
  left_list uuid,
  synced_at timestamptz not null default now(),
  primary key (task_id)
);
create unique index github_issue_once on github_issue (link_id, number);
alter table github_issue enable row level security;
create policy gi2_in_project on github_issue for all to tracker_app
  using (workspace_id in (select staff_workspaces())
         and (current_workspace() is null or workspace_id = current_workspace())
         and project_id in (select visible_projects()))
  with check (workspace_id in (select staff_workspaces())
              and (current_workspace() is null or workspace_id = current_workspace())
              and project_id in (select visible_projects()));
grant select, insert, update, delete on github_issue to tracker_app;

create table github_comment (
  workspace_id uuid not null references workspace(id),
  project_id uuid not null references project(id),
  comment_id uuid not null references comment(id),
  github_id bigint not null,
  seen_body text,
  primary key (comment_id)
);
create unique index github_comment_once on github_comment (workspace_id, github_id);
alter table github_comment enable row level security;
create policy gc_in_project on github_comment for all to tracker_app
  using (workspace_id in (select staff_workspaces())
         and (current_workspace() is null or workspace_id = current_workspace())
         and project_id in (select visible_projects()))
  with check (workspace_id in (select staff_workspaces())
              and (current_workspace() is null or workspace_id = current_workspace())
              and project_id in (select visible_projects()));
grant select, insert, update, delete on github_comment to tracker_app;

/* What is owed to GitHub. One row a change; the worker sends the newest
   state of the thing, so three edits in a second are one request. */
create table github_out (
  id uuid primary key,
  workspace_id uuid not null references workspace(id),
  project_id uuid not null references project(id),
  kind text not null check (kind in ('task', 'comment', 'gone', 'import')),
  object_id uuid not null,
  actor_id uuid not null references actor(id),
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  tries int not null default 0,
  done_at timestamptz,
  error text
);
create index github_out_waiting on github_out (created_at) where done_at is null;
alter table github_out enable row level security;
/* Written by whoever made the change, inside their workspace; read only
   through the claim below. */
create policy go_write on github_out for insert to tracker_app
  with check (workspace_id = current_workspace() and project_id in (select visible_projects()));
grant insert on github_out to tracker_app;

create function github_out_claim(p_n int) returns table (
  id uuid, workspace_id uuid, project_id uuid, kind text, object_id uuid, actor_id uuid
)
language sql volatile security definer set search_path = public as $$
  update github_out o set claimed_at = now(), tries = o.tries + 1
  where o.id in (
    select w.id from github_out w
    where w.done_at is null and w.tries < 5
      and (w.claimed_at is null or w.claimed_at < now() - interval '5 minutes')
      /* One at a time a project, in order: a later change never overtakes
         an earlier one to the same issue. */
      and not exists (
        select 1 from github_out b
        where b.project_id = w.project_id and b.done_at is null and b.created_at < w.created_at
          and b.tries < 5)
    order by w.created_at
    limit p_n
    for update skip locked
  )
  returning o.id, o.workspace_id, o.project_id, o.kind, o.object_id, o.actor_id
$$;
grant execute on function github_out_claim(int) to tracker_app;

create function github_out_done(p_id uuid, p_error text, p_retry boolean) returns void
language sql volatile security definer set search_path = public as $$
  update github_out
  set done_at = case when p_retry then null else now() end,
      claimed_at = case when p_retry then null else claimed_at end,
      error = p_error
  where id = p_id
$$;
grant execute on function github_out_done(uuid, text, boolean) to tracker_app;

/* People here by who they are on GitHub, for one workspace's members:
   an issue's assignees and a comment's author. Only ids and logins. */
create function github_people(p_workspace uuid) returns table (actor_id uuid, github_id bigint, login text)
language sql stable security definer set search_path = public as $$
  select g.actor_id, g.github_id, g.login
  from github_person g
  join membership m on m.actor_id = g.actor_id and m.workspace_id = p_workspace
    and m.deleted_at is null and m.joined_at is not null
$$;
grant execute on function github_people(uuid) to tracker_app;

/* A person's token, for the worker writing as them; sealed, as kept. */
create function github_person_token(p_actor uuid) returns table (token_enc text, refresh_enc text, token_until timestamptz)
language sql stable security definer set search_path = public as $$
  select token_enc, refresh_enc, token_until from github_person where actor_id = p_actor
$$;
grant execute on function github_person_token(uuid) to tracker_app;

create function github_person_retoken(p_actor uuid, p_token text, p_refresh text, p_until timestamptz, p_refresh_until timestamptz)
returns void language sql volatile security definer set search_path = public as $$
  update github_person set token_enc = p_token, refresh_enc = coalesce(p_refresh, refresh_enc),
    token_until = p_until, refresh_until = coalesce(p_refresh_until, refresh_until), updated_at = now()
  where actor_id = p_actor
$$;
grant execute on function github_person_retoken(uuid, text, text, timestamptz, timestamptz) to tracker_app;

/* A comment written on GitHub by somebody who is not a person here keeps
   their name, as a line from Slack does (`message.said_as`). */
alter table comment add column said_as text;

/*
 * Events are taken three seconds after they arrive, not at once. A comment
 * written to GitHub as a person comes back as that person's event, and the
 * pairing that says it is our own is written the moment GitHub answers the
 * request — this is the room for that answer to land before its echo does.
 */
drop function github_events_claim(int);
create function github_events_claim(p_n int, p_wait interval default '3 seconds') returns table (id text, event text, installation_id bigint, payload jsonb)
language sql volatile security definer set search_path = public as $$
  update github_event e set claimed_at = now(), tries = e.tries + 1
  where e.id in (
    select w.id from github_event w
    where w.done_at is null and w.tries < 5
      and w.received_at <= now() - p_wait
      and (w.claimed_at is null or w.claimed_at < now() - interval '5 minutes')
    order by w.received_at
    limit p_n
    for update skip locked
  )
  returning e.id, e.event, e.installation_id, e.payload
$$;
grant execute on function github_events_claim(int, interval) to tracker_app;

/* Where the worker writes to GitHub for a project: its repository and the
   installation that may write there. */
create function github_target(p_project uuid) returns table (
  link_id uuid, repo_name text, installation_id bigint, linked_by uuid, issues boolean, workspace_id uuid, project_key text
)
language sql stable security definer set search_path = public as $$
  select l.id, l.repo_name, i.installation_id, l.linked_by, l.issues, l.workspace_id, p.key::text
  from github_link l
  join github_install i on i.id = l.install_id and i.deleted_at is null
  join project p on p.id = l.project_id
  where l.project_id = p_project and l.deleted_at is null
$$;
grant execute on function github_target(uuid) to tracker_app;
