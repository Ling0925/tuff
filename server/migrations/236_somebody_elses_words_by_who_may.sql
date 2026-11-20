/*
 * Somebody else's comment, changed or taken back by whoever may.
 *
 * `PATCH` and `DELETE /api/comments/:id` let the owner and whoever runs the
 * project (or holds `edit.any` on it) change what somebody else said —
 * `mayEditSaid`, `docs/specs/comments.md` — and `cmt_update` let a person
 * update only their own rows. So the owner's edit answered 404 (the row
 * read `for update` was not there) and the owner's delete answered 200 and
 * changed nothing. The policy now lets the same people through that `can()`
 * does — `content.edit.said`: the owner, `edit.any` or `manage` on the
 * project — and nobody wider, so it stays a ceiling under the application's
 * question rather than replacing it. A token held to some projects reaches
 * no further than they.
 *
 * That a token never rewrites somebody else's comment is the server's
 * (`server/src/http/objects.ts`): whether a request came through one is not
 * something the database is told for every kind of token.
 */
create function may_edit_said(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select ((select token_projects()) is null or p = any ((select token_projects())::uuid[])) and (
    exists (
      select 1 from project pr
      where pr.id = p and role_in(pr.workspace_id) = 'owner'
    ) or exists (
      select 1 from project_member pm
      where pm.project_id = p and pm.actor_id = current_actor()
        and pm.deleted_at is null and pm.rights && array['manage', 'edit.any']
    )
  )
$$;
revoke all on function may_edit_said(uuid) from public;
grant execute on function may_edit_said(uuid) to tracker_app;

drop policy cmt_update on comment;
create policy cmt_update on comment for update using (
  author_id = current_actor()
  or (project_id is not null and project_id in (select visible_projects()) and may_edit_said(project_id))
) with check (true);
