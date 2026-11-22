/*
 * Getting in has a role of its own, phase 1 of 2.
 *
 * After 306 nothing wrote a sign-in column directly, and SQL run as the
 * application could still take any account over: every definer function
 * that writes a password, an address, a second factor, a provider's
 * identity, a ticket or a recovery code — and the server's mail and its
 * owners, through which a password reset is read — was the application
 * role's to run, each trusts the actor id it is handed, and
 * `current_actor()` is a setting the application sets for itself.
 *
 * Those become a role's own, `tracker_auth`, which only the sign-in code
 * connects as (`asAuth`, `db.ts`; its own small pool and its own
 * connection string, `DATABASE_URL_AUTH` or made from `DATABASE_URL_APP` —
 * `db/authUrl.ts`).
 *
 * **Two migrations, two deploys.** This one gives `tracker_auth`
 * everything it needs and takes nothing from `tracker_app`, so a container
 * still running the code from before it — the old one while the new one
 * starts, or the one a failed deploy rolls back to — signs people in as it
 * did. Migration 311 takes the rights from `tracker_app`, and ships in the
 * deploy after this one, once every container connects as `tracker_auth`
 * for signing in.
 *
 * 1. **The role.** Made `nologin` here as 002 and 153 made theirs; the
 *    migrating start gives it a password and login from the string the
 *    server connects with (`letTheAppIn`). A **member of `tracker_app`**,
 *    inheriting: a sign-in transaction also reads memberships, writes the
 *    audit log, makes a workspace — everything a request does, under the
 *    same policies (each is `to public` or `to tracker_app`, and a member
 *    of `tracker_app` passes both). It owns nothing and bypasses nothing,
 *    which `rlsGuard.ts` asks at start. CONNECT on the database by name, as
 *    298 gave the other two. On Postgres 16 and later the role running the
 *    migrations needs ADMIN OPTION on `tracker_app` to grant it — a
 *    superuser has it, and so does the role that made `tracker_app`.
 *
 * 2. **The definers.** EXECUTE given to `tracker_auth`, by name and every
 *    overload: those that write a way in, hand back what one is made of,
 *    answer the sign-in routes' tickets, make, trade or end a session, an
 *    OAuth code or a token, delete an account, read or renew a person's
 *    GitHub token by request, and set the server's mail and owners. The
 *    list is `AUTH_DEFINERS` in `test/auth-role.test.ts` and in
 *    `docs/api.md`; a name here that no function has stops the migration.
 *
 * 3. **The tables.** INSERT on `refresh_session` and `api_token`, UPDATE of
 *    `api_token.revoked_at`, and INSERT, UPDATE and DELETE on
 *    `github_person`, granted to `tracker_auth` by name, so they stay its
 *    when 311 takes them from the application. The insert policies already
 *    apply to it.
 */

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'tracker_auth') then
    create role tracker_auth nologin;
  end if;
end $$;

grant tracker_app to tracker_auth;
grant usage on schema public to tracker_auth;
do $$
begin
  execute format('grant connect on database %I to tracker_auth', current_database());
end $$;

-- 2. The definers.
do $$
declare
  names text[] := array[
    -- A way in, written.
    'accept_invite', 'auth_change_password', 'auth_claim_email', 'auth_confirm_email',
    'auth_confirm_if_invited', 'auth_email_cancel', 'auth_email_change', 'auth_email_ticket',
    'auth_identity_forget', 'auth_identity_link', 'auth_identity_remove', 'auth_recovery_replace',
    'auth_recovery_spend', 'auth_set_password', 'auth_ticket_make', 'auth_ticket_make_bound',
    'auth_ticket_spend', 'auth_ticket_start', 'auth_totp_begin', 'auth_totp_disable',
    'auth_totp_enable', 'auth_totp_spend', 'digest_off', 'instance_setup_owner', 'register_owner',
    -- What a way in is made of, read.
    'auth_lookup_user', 'auth_password_hash', 'auth_totp_secret', 'auth_totp_secret_for',
    -- The tickets, asked.
    'auth_app_start_once', 'auth_email_ticket_peek', 'auth_ticket_binding', 'auth_ticket_peek',
    'auth_ticket_recent', 'auth_ticket_started',
    -- A session, a code or a token: made, traded, ended.
    'agent_end_tokens', 'agent_oauth_end', 'auth_end_session', 'auth_revoke_others',
    'auth_revoke_session', 'auth_spend_refresh', 'nowhere_session_end', 'oauth_agent_link',
    'oauth_code_make', 'oauth_code_take', 'oauth_refresh_take', 'oauth_token_bind',
    -- An account, deleted.
    'delete_my_account', 'operator_delete_account',
    -- A person's GitHub token, by request.
    'github_person_retoken', 'github_person_token',
    -- The server's mail, which carries every reset link, and its owners.
    'instance_add_owner', 'instance_mail_clear', 'instance_mail_write', 'instance_remove_owner'
  ];
  missing text[];
  f regprocedure;
begin
  select array_agg(n order by n) into missing
  from unnest(names) n
  where not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = n);
  if missing is not null then
    raise exception 'no function named %', missing;
  end if;
  for f in
    select p.oid::regprocedure from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = any (names)
  loop
    execute format('grant execute on function %s to tracker_auth', f);
  end loop;
end $$;

-- 3. The tables.
grant insert on refresh_session to tracker_auth;
grant insert on api_token to tracker_auth;
grant update (revoked_at) on api_token to tracker_auth;
grant insert, update, delete on github_person to tracker_auth;
