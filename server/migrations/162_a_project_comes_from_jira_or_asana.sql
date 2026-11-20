/*
 * A project brought across from Jira or Asana.
 *
 * The same row as Linear's, saying where from: one claim, one Stop, one
 * clear-out and one "is this project still importing" for all three. The
 * key column holds whatever that product's key is — for Jira its site, its
 * email and its token together — sealed, and only while the import runs.
 */
alter table linear_import add column source text not null default 'linear'
  check (source in ('linear', 'jira', 'asana'));
grant select (source) on linear_import to tracker_app;

/* The worker's claim says where from, so a turn knows whose API to ask. */
drop function linear_import_claim();
create function linear_import_claim() returns table (
  id uuid, workspace_id uuid, actor_id uuid, key_enc text, teams jsonb, progress jsonb, source text
)
language sql volatile security definer set search_path = public as $$
  update linear_import i set claimed_at = now()
  where i.id = (
    select w.id from linear_import w
    where w.state = 'running' and w.key_enc is not null
      and (w.claimed_at is null or w.claimed_at < now() - interval '10 minutes')
    order by coalesce(w.last_turn_at, w.created_at)
    limit 1
    for update skip locked
  )
  returning i.id, i.workspace_id, i.actor_id, i.key_enc, i.teams, i.progress, i.source
$$;
revoke execute on function linear_import_claim() from public, tracker_app;
grant execute on function linear_import_claim() to tracker_worker;
