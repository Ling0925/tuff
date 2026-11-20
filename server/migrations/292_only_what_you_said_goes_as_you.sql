/*
 * Only what a person said themselves goes to GitHub in their name.
 *
 * The comment sync wrote every comment of somebody with a linked GitHub
 * with that person's own token. A comment here can be changed by somebody
 * else — the owner or whoever runs the project edits anybody's words, and
 * puts back a comment somebody deleted — so a manager's sentence went to
 * GitHub as the contributor, possibly into a public repository. And it went
 * on after the contributor was removed from the workspace, because their
 * `github_person` row stayed.
 *
 * Four things here:
 *
 * 1. `comment.changed_by`: who made the comment's last change — writing
 *    it, editing it, deleting it or putting it back — set by the database
 *    from the actor the write was made as, so no path can forget it, and
 *    kept as it was by any update that changes neither the words nor
 *    whether it stands, so no request can write it either. A write with
 *    nobody behind it is nobody's (null), which the sync reads as not the
 *    author's.
 *
 * 2. `github_comment.said_hash`: the md5 of the comment's own body when it
 *    was last sent. What GitHub got is Markdown made from that body, and the
 *    Markdown changes by itself — a mention is `@login` while the person
 *    has linked their GitHub and their name in bold once they unlink or
 *    leave — so the text sent is no measure of whether anybody changed the
 *    words. A row from before this has none; then a comment nobody has
 *    written to since (`changed_by` null) counts as unchanged.
 *
 * 3. `github_person_token_in`: a person's token, for the worker, only while
 *    they are in that workspace and on that project (or its owner, who is
 *    on every project, as `visible_projects` says). The sync asks this one
 *    and no other — `github_person_token` is the asker's own again, no
 *    longer the worker's — so a person who left is never written as,
 *    whatever is still kept.
 *
 * 4. Ending somebody's last membership — removal, leaving, a workspace
 *    deleted — drops their linked GitHub. One `github_person` is the
 *    person's in every workspace they are in, so leaving one of several
 *    keeps it for the others: an owner who takes somebody out of their
 *    workspace has no say over that person's GitHub in another company's,
 *    and (3) already stops the one they left from using it. A trigger on
 *    the membership row rather than a line in `workspace_member_end`, so
 *    every way a membership ends is covered, account deletion's included
 *    (which also drops it with `app_user`, migration 151). A trigger cannot
 *    call GitHub, so the grant on GitHub's side is not revoked as unlinking
 *    revokes it (`letGo`); the token is gone from here, and the person can
 *    revoke the app in their GitHub settings.
 *
 * Changes no rows. A person who left every workspace before this still has
 * their row; clearing those is a separate migration that runs first on a
 * copy of production.
 *
 * Written to run twice: it was applied to a shared development database
 * once before its final shape.
 */

/* ------------------------------------------------------------ 1. who said it */

alter table comment add column if not exists changed_by uuid references actor(id) on delete set null;

create or replace function comment_changed_by() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT'
     or new.body is distinct from old.body
     or new.deleted_at is distinct from old.deleted_at then
    new.changed_by := current_actor();
  else
    new.changed_by := old.changed_by;
  end if;
  return new;
end $$;

drop trigger if exists changed_by on comment;
create trigger changed_by before insert or update on comment
  for each row execute function comment_changed_by();

/* ------------------------------------------------------ 2. what was sent from */

alter table github_comment add column if not exists said_hash text;

/* ---------------------------------------------- 3. a token, where they still are */

create or replace function github_person_token_in(p_actor uuid, p_workspace uuid, p_project uuid)
returns table (token_enc text, refresh_enc text, token_until timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select g.token_enc, g.refresh_enc, g.token_until from github_person g
  where g.actor_id = p_actor
    and session_user = 'tracker_worker'
    and exists (select 1 from project p where p.id = p_project and p.workspace_id = p_workspace and p.deleted_at is null)
    and exists (
      select 1 from membership m
      where m.workspace_id = p_workspace and m.actor_id = p_actor
        and m.deleted_at is null and m.joined_at is not null
        and (m.role = 'owner' or exists (
          select 1 from project_member pm
          where pm.project_id = p_project and pm.workspace_id = p_workspace
            and pm.actor_id = p_actor and pm.deleted_at is null)))
$$;
revoke all on function github_person_token_in(uuid, uuid, uuid) from public;
grant execute on function github_person_token_in(uuid, uuid, uuid) to tracker_worker;

/* The worker asks the one above; this one stays a request's, for the
   asker's own token (migration 153's other half). */
revoke execute on function github_person_token(uuid) from tracker_worker;

/* ----------------------------------------------- 4. the last workspace left */

create or replace function github_person_leaves() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (
    select 1 from membership m
    where m.actor_id = new.actor_id and m.deleted_at is null and m.joined_at is not null
  ) then
    delete from github_person where actor_id = new.actor_id;
  end if;
  return null;
end $$;
revoke all on function github_person_leaves() from public;

drop trigger if exists membership_takes_github on membership;
create trigger membership_takes_github after update of deleted_at on membership
  for each row when (old.deleted_at is null and new.deleted_at is not null)
  execute function github_person_leaves();
