/*
 * A team brought across from Linear.
 *
 * One row an import: who asked, in which workspace, which of the key's
 * teams, how far each has got. The Linear key is in it, sealed, only while
 * the import runs: it is somebody's whole Linear account, and it is cleared
 * the moment the import ends either way. The application role reads the
 * row without the key — a column it is not granted — and the worker alone
 * claims the work, key and all.
 */
create table linear_import (
  id uuid primary key,
  workspace_id uuid not null references workspace(id),
  actor_id uuid not null references actor(id),
  key_enc text,
  /* [{ id, key, name, issues }] — the teams chosen, as Linear named them. */
  teams jsonb not null,
  /* { teamId: { project_id, cursor, done, issues } } — written by the worker. */
  progress jsonb not null default '{}',
  state text not null default 'running' check (state in ('running', 'done', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  finished_at timestamptz
);
create index linear_import_running on linear_import (created_at) where state = 'running';
alter table linear_import enable row level security;
create policy li_own on linear_import for all to tracker_app
  using (workspace_id = current_workspace() and actor_id = current_actor())
  with check (workspace_id = current_workspace() and actor_id = current_actor());
grant select (id, workspace_id, actor_id, teams, progress, state, error, created_at, finished_at) on linear_import to tracker_app;
grant insert on linear_import to tracker_app;

/* Which import made a project, and from which Linear team: a task's number
   is given as it was only on a project its own import made. */
alter table project add column import_id uuid references linear_import(id);
alter table project add column imported_from text;

/* The worker's: the next import with work left, its key with it. */
create function linear_import_claim() returns table (
  id uuid, workspace_id uuid, actor_id uuid, key_enc text, teams jsonb, progress jsonb
)
language sql volatile security definer set search_path = public as $$
  update linear_import i set claimed_at = now()
  where i.id = (
    select w.id from linear_import w
    where w.state = 'running' and w.key_enc is not null
      and (w.claimed_at is null or w.claimed_at < now() - interval '10 minutes')
    order by w.created_at
    limit 1
    for update skip locked
  )
  returning i.id, i.workspace_id, i.actor_id, i.key_enc, i.teams, i.progress
$$;

create function linear_import_progress(p_id uuid, p_progress jsonb) returns void
language sql volatile security definer set search_path = public as $$
  update linear_import set progress = p_progress, claimed_at = now() where id = p_id and state = 'running'
$$;

/* Ended, either way, and the key with it. */
create function linear_import_finish(p_id uuid, p_error text) returns void
language sql volatile security definer set search_path = public as $$
  update linear_import
  set state = case when p_error is null then 'done' else 'failed' end,
      error = p_error, key_enc = null, finished_at = now()
  where id = p_id
$$;

/* An import left running past a day is ended, key and all: a key is not
   kept for an import nobody is waiting for. */
create function linear_imports_clear() returns integer
language sql volatile security definer set search_path = public as $$
  with gone as (
    update linear_import set state = 'failed', error = coalesce(error, 'stopped'), key_enc = null, finished_at = now()
    where state = 'running' and created_at < now() - interval '1 day'
    returning 1
  )
  select count(*)::int from gone
$$;

revoke execute on function linear_import_claim() from public;
revoke execute on function linear_import_progress(uuid, jsonb) from public;
revoke execute on function linear_import_finish(uuid, text) from public;
revoke execute on function linear_imports_clear() from public;
grant execute on function linear_import_claim() to tracker_worker;
grant execute on function linear_import_progress(uuid, jsonb) to tracker_worker;
grant execute on function linear_import_finish(uuid, text) to tracker_worker;
grant execute on function linear_imports_clear() to tracker_worker;
