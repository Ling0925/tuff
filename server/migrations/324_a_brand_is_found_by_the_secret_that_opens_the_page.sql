/*
 * What the review of 323 found.
 *
 * `workspace_brand(id)` answered any branded workspace's name and mark to
 * the application role, by an id, outside the policies. Now only the
 * worker asks it, for a digest; a request finds a brand through the secret
 * that opens its page — a document's token, an invitation's hash, a
 * feedback page's address — or reads its own workspace under the policies
 * (`brand.ts`, `brandHere`).
 *
 * And a brand only while the page it is shown on is one: a feedback page
 * that is off, or whose project is archived or gone, says nothing of the
 * workspace; nor does an invitation used or past its day.
 */
create or replace function feedback_page_brand(p_slug text)
returns table (id uuid, name text, mark_icon text, mark_tint smallint, icon_key text)
language sql stable security definer set search_path = public, pg_temp as $$
  select b.id, b.name, b.mark_icon, b.mark_tint, b.icon_key
  from feedback_page_by_slug(p_slug) f
  cross join lateral workspace_brand(f.workspace_id) b
  where f.available
$$;
revoke execute on function feedback_page_brand(text) from public;
grant execute on function feedback_page_brand(text) to tracker_app;

create or replace function invite_brand(p_token_hash text)
returns table (id uuid, name text, mark_icon text, mark_tint smallint, icon_key text)
language sql stable security definer set search_path = public, pg_temp as $$
  select b.id, b.name, b.mark_icon, b.mark_tint, b.icon_key
  from invite i
  cross join lateral workspace_brand(i.workspace_id) b
  where i.token_hash = p_token_hash
    and i.deleted_at is null and i.used_at is null and i.expires_at > now()
$$;

revoke execute on function workspace_brand(uuid) from tracker_app;
grant execute on function workspace_brand(uuid) to tracker_worker;
