/*
 * A workspace on Company or Unlimited wears its own name and mark on what
 * it shows to the people it works with.
 *
 * Nothing is stored: the brand is the name and mark the workspace already
 * has, and the plan decides whether they are worn, at every read. A
 * downgrade takes it away the next time anything is asked, and there is no
 * flag to clear.
 *
 * Which plans, beside how many people and bytes each holds.
 */
create or replace function plan_branded(p text) returns boolean
language sql immutable set search_path = public as $$
  select coalesce(p in ('company', 'unlimited'), false)
$$;
grant execute on function plan_branded(text) to tracker_app, tracker_worker;

/*
 * The face a branded workspace shows: its name, its chosen glyph and
 * colour, and its picture's key, which the server signs. Nothing at all for
 * a workspace that is not branded, deleted, or a board's — so an unbranded
 * workspace's name never leaves through here, whoever asks with whatever
 * id. The application asks it with an id it already holds (the session's,
 * a feedback page's), and the worker for a digest.
 */
create or replace function workspace_brand(p_workspace uuid)
returns table (id uuid, name text, mark_icon text, mark_tint smallint, icon_key text)
language sql stable security definer set search_path = public, pg_temp as $$
  select w.id, w.name, w.mark_icon, w.mark_tint, w.icon_key
  from workspace w
  where w.id = p_workspace
    and w.deleted_at is null
    and not w.scratch
    and plan_branded(w.plan)
$$;
revoke execute on function workspace_brand(uuid) from public;
grant execute on function workspace_brand(uuid) to tracker_app, tracker_worker;

/*
 * The same, found through the secret that opens the page: a shared
 * document's token — only while `public_document` still answers it — and
 * an invitation's hash, revoked ones answering nothing as they do in
 * `preview_invite`'s caller.
 */
create or replace function public_document_brand(p_token text)
returns table (id uuid, name text, mark_icon text, mark_tint smallint, icon_key text)
language sql stable security definer set search_path = public, pg_temp as $$
  select b.id, b.name, b.mark_icon, b.mark_tint, b.icon_key
  from public_document(p_token) d
  join file f on f.id = d.id
  cross join lateral workspace_brand(f.workspace_id) b
$$;
revoke execute on function public_document_brand(text) from public;
grant execute on function public_document_brand(text) to tracker_app;

create or replace function invite_brand(p_token_hash text)
returns table (id uuid, name text, mark_icon text, mark_tint smallint, icon_key text)
language sql stable security definer set search_path = public, pg_temp as $$
  select b.id, b.name, b.mark_icon, b.mark_tint, b.icon_key
  from invite i
  cross join lateral workspace_brand(i.workspace_id) b
  where i.token_hash = p_token_hash and i.deleted_at is null
$$;
revoke execute on function invite_brand(text) from public;
grant execute on function invite_brand(text) to tracker_app;
