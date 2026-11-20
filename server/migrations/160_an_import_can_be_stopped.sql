/*
 * An import stopped by whoever started it.
 *
 * The first real imports stopped on their own and showed "Importing…" for
 * the hour it took to give up, with nothing to press. Stopped here, the
 * key goes at once, and the worker's next write is refused: its doors ask
 * that the import is still running.
 */
create function linear_import_stop(p_id uuid) returns boolean
language sql volatile security definer set search_path = public as $$
  with stopped as (
    update linear_import
    set state = 'failed', error = 'Stopped.', key_enc = null, finished_at = now()
    where id = p_id and state = 'running'
      and actor_id = current_actor() and workspace_id = current_workspace()
    returning 1
  )
  select exists (select 1 from stopped)
$$;
revoke execute on function linear_import_stop(uuid) from public;
grant execute on function linear_import_stop(uuid) to tracker_app;
