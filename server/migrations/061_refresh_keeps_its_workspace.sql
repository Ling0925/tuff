/*
 * A refresh comes back to the workspace it left.
 *
 * `refresh_session` held who, not where, so `refresh` picked the workspace
 * by hand: the caller's oldest membership. One account in two workspaces,
 * working in the second, access token expires, the next request is answered
 * 401, the client refreshes — and comes back holding a session in the
 * *first* one.
 *
 * Row-level security then does exactly what it should and the screen is the
 * lie: the project's lists and its tasks are both read in the wrong
 * workspace, so both answer 200 with nothing in them. No error anywhere, the
 * name and the tabs still drawn from what was already in memory, and a
 * project with five lists and five tasks in it saying "Nothing here yet."
 *
 * The workspace belongs on the session, so it is stored on the session.
 */
alter table refresh_session
  add column workspace_id uuid references workspace(id) on delete cascade;

comment on column refresh_session.workspace_id is
  'Which workspace this session is in. Null on rows written before 061, which fall back to the oldest membership the way the old code did.';

-- Dropped and made again: the row it returns has a third column now, and
-- `create or replace` may not change that.
drop function if exists auth_spend_refresh(text);
create function auth_spend_refresh(p_hash text)
returns table (session_id uuid, actor_id uuid, workspace_id uuid)
language sql security definer set search_path = public as $$
  update refresh_session s set revoked_at = now()
  where s.token_hash = p_hash and s.revoked_at is null and s.expires_at > now()
  returning s.id, s.actor_id, s.workspace_id
$$;

grant execute on function auth_spend_refresh to tracker_app;
