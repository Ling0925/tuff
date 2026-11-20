/*
 * The worker's own role, the fifth audit's
 * leftover in the security audit spec.
 *
 * The worker's functions are `security definer` and take ids from their
 * caller: claim the next GitHub events, mark them done, stop a link, list
 * a workspace's people by GitHub login, a person's sealed GitHub token,
 * the clear-out, the gifts that end. They were the application role's to
 * call, and every request runs as the application role. Nothing reached
 * them with an id it had not checked, and no SQL is built from text — but
 * the day an injection exists, it would have read anybody's GitHub token
 * and stopped another company's link. They are `tracker_worker`'s now, a
 * role only the worker connects as (`DATABASE_URL_WORKER`), and the
 * application role cannot call them.
 *
 * Created `nologin` with no password, as `tracker_app` was: the password is
 * set at migration from the connection string it will be used with
 * (`letTheWorkerIn`, `server/src/db/migrate.ts`), never written here.
 */
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'tracker_worker') then
    create role tracker_worker nologin;
  end if;
end $$;

grant usage on schema public to tracker_worker;

/* From `public` as well as the application role: a function is anybody's
   to run until that is taken back, and only granting it to one role
   changed nothing for the others. */

revoke execute on function end_gifts() from public, tracker_app;
revoke execute on function purge_queues() from public, tracker_app;
revoke execute on function storage_orphans(int) from public, tracker_app;
revoke execute on function storage_orphans_gone(text[]) from public, tracker_app;
revoke execute on function push_targets(uuid, uuid) from public, tracker_app;
revoke execute on function push_recounts(int) from public, tracker_app;
revoke execute on function github_events_claim(int, interval) from public, tracker_app;
revoke execute on function github_event_done(text, text, boolean) from public, tracker_app;
revoke execute on function github_events_clear() from public, tracker_app;
revoke execute on function github_install_gone(bigint) from public, tracker_app;
revoke execute on function github_repo_gone(bigint, bigint) from public, tracker_app;
revoke execute on function github_link_stop(uuid, text) from public, tracker_app;
revoke execute on function github_out_claim(int) from public, tracker_app;
revoke execute on function github_out_done(uuid, text, boolean) from public, tracker_app;
revoke execute on function github_people(uuid) from public, tracker_app;
revoke execute on function github_target(uuid) from public, tracker_app;

grant execute on function end_gifts() to tracker_worker;
grant execute on function purge_queues() to tracker_worker;
grant execute on function storage_orphans(int) to tracker_worker;
grant execute on function storage_orphans_gone(text[]) to tracker_worker;
grant execute on function push_targets(uuid, uuid) to tracker_worker;
grant execute on function push_recounts(int) to tracker_worker;
grant execute on function github_events_claim(int, interval) to tracker_worker;
grant execute on function github_event_done(text, text, boolean) to tracker_worker;
grant execute on function github_events_clear() to tracker_worker;
grant execute on function github_install_gone(bigint) to tracker_worker;
grant execute on function github_repo_gone(bigint, bigint) to tracker_worker;
grant execute on function github_link_stop(uuid, text) to tracker_worker;
grant execute on function github_out_claim(int) to tracker_worker;
grant execute on function github_out_done(uuid, text, boolean) to tracker_worker;
grant execute on function github_people(uuid) to tracker_worker;
grant execute on function github_target(uuid) to tracker_worker;

/*
 * A person's GitHub token is asked for by the worker, writing as whoever
 * linked a repository, and by a request about the person's own GitHub —
 * which repositories they can read. The second may have only their own:
 * as the application role, the actor the transaction is for.
 */
create or replace function github_person_token(p_actor uuid)
returns table (token_enc text, refresh_enc text, token_until timestamptz)
language sql stable security definer set search_path = public as $$
  select token_enc, refresh_enc, token_until from github_person
  where actor_id = p_actor
    and (session_user = 'tracker_worker' or p_actor = current_actor())
$$;
grant execute on function github_person_token(uuid) to tracker_worker;

create or replace function github_person_retoken(p_actor uuid, p_token text, p_refresh text, p_until timestamptz, p_refresh_until timestamptz)
returns void language sql volatile security definer set search_path = public as $$
  update github_person set token_enc = p_token, refresh_enc = coalesce(p_refresh, refresh_enc),
    token_until = p_until, refresh_until = coalesce(p_refresh_until, refresh_until), updated_at = now()
  where actor_id = p_actor
    and (session_user = 'tracker_worker' or p_actor = current_actor())
$$;
grant execute on function github_person_retoken(uuid, text, text, timestamptz, timestamptz) to tracker_worker;
