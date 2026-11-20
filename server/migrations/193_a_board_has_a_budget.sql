/*
 * What the security review of boards found.
 *
 * A board was a place to keep any amount of text for free: five hundred
 * tasks of four thousand characters with a hundred comments each is two
 * hundred megabytes behind one link. It has a budget now, spent in the
 * same statement that checks it, so two writes arriving together cannot
 * both fit in the last room there is.
 *
 * A board an operator ended is not saved into anybody's workspace: what was
 * reported does not move into a company by the same link.
 *
 * And `workspace.scratch` is not the application's to write: an owner who
 * set it on their own company would take it off the operators' lists.
 */

alter table scratch_board
  add column chars_used bigint not null default 0,
  add column comments_made integer not null default 0;

/*
 * Spend some of a board's budget, or refuse: characters written and
 * comments made, counted over its life. Called inside the transaction
 * that writes them, so a write that fails gives the room back.
 */
create function board_spend(p_hash text, p_chars int, p_comments int, p_most_chars bigint, p_most_comments int)
returns boolean
language plpgsql volatile security definer set search_path = public as $$
begin
  update scratch_board
  set chars_used = chars_used + greatest(p_chars, 0),
      comments_made = comments_made + greatest(p_comments, 0)
  where edit_hash = p_hash and space_id is not null and ended_at is null and saved_at is null
    and expires_at >= now()
    and chars_used + greatest(p_chars, 0) <= p_most_chars
    and comments_made + greatest(p_comments, 0) <= p_most_comments;
  return found;
end $$;
revoke all on function board_spend(text, int, int, bigint, int) from public;
grant execute on function board_spend(text, int, int, bigint, int) to tracker_app;

/* What a board holds, for saving — never one an operator ended. */
create or replace function board_contents(p_hash text)
returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'name', p.name,
    'tasks', coalesce((
      select json_agg(json_build_object(
        'id', t.id, 'number', t.number, 'title', t.title, 'body', t.body,
        'list', (select l.sort_key from task_list l where l.id = t.list_id),
        'by', (select a.name from actor a where a.id = t.author_id),
        'has', (select string_agg(a.name, ', ') from actor a where a.id = any(t.assignee_ids)),
        'comments', coalesce((
          select json_agg(json_build_object(
            'body', c.body, 'by', (select a.name from actor a where a.id = c.author_id),
            'at', c.created_at) order by c.created_at)
          from comment c
          where c.object_type = 'task' and c.object_id = t.id and c.deleted_at is null), '[]')
      ) order by l2.sort_key, t.sort_key, t.id)
      from task t left join task_list l2 on l2.id = t.list_id
      where t.project_id = b.project_id and t.deleted_at is null and t.parent_id is null), '[]')
  )
  from scratch_board b join project p on p.id = b.project_id
  where b.edit_hash = p_hash and b.space_id is not null and b.saved_at is null
    and b.ended_by is distinct from 'operator'
$$;

/* How much a save would carry, counted rather than built — the screen
   that asks first reads only this. */
create function board_counts(p_hash text)
returns table (tasks integer, comments integer)
language sql stable security definer set search_path = public as $$
  select (select count(*)::int from task t
          where t.project_id = b.project_id and t.deleted_at is null and t.parent_id is null),
         (select count(*)::int from comment c join task t on t.id = c.object_id
          where c.object_type = 'task' and t.project_id = b.project_id
            and c.deleted_at is null and t.deleted_at is null and t.parent_id is null)
  from scratch_board b
  where b.edit_hash = p_hash and b.space_id is not null and b.saved_at is null
    and b.ended_by is distinct from 'operator'
$$;
revoke all on function board_counts(text) from public;
grant execute on function board_counts(text) to tracker_app;

create or replace function board_save_take(p_hash text, p_project uuid, p_workspace uuid, p_keep_days int)
returns boolean
language plpgsql volatile security definer set search_path = public as $$
begin
  update scratch_board
  set saved_at = now(), saved_project_id = p_project, saved_workspace_id = p_workspace,
      expires_at = least(expires_at, now() + make_interval(days => p_keep_days))
  where edit_hash = p_hash and space_id is not null and saved_at is null
    and ended_by is distinct from 'operator';
  return found;
end $$;

/* Ending a board now answers its workspace, so the board's sockets can be
   told at once rather than at their next check. */
drop function operator_end_board(uuid);
create function operator_end_board(p_board uuid)
returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare
  ws uuid;
begin
  if not is_operator() then return null; end if;
  update scratch_board set ended_at = coalesce(ended_at, now()), ended_by = 'operator',
                           expires_at = least(expires_at, now())
  where id = p_board and space_id is not null
  returning space_id into ws;
  if not found then return null; end if;
  update workspace set deleted_at = coalesce(deleted_at, now()) where id = ws;
  update scratch_report set handled_at = now() where board_id = p_board and handled_at is null;
  return ws;
end $$;
revoke all on function operator_end_board(uuid) from public;
grant execute on function operator_end_board(uuid) to tracker_app;

/*
 * Every column of a workspace the application may write, but `scratch`.
 * Granted by column, so a column added to `workspace` later is granted
 * here by name too, or the application cannot write it.
 */
revoke insert, update on workspace from tracker_app;
grant insert (id, name, slug, settings, plan, limits, created_at, updated_at, deleted_at,
              mark_icon, mark_tint, icon_key, purge_tries) on workspace to tracker_app;
grant update (id, name, slug, settings, plan, limits, created_at, updated_at, deleted_at,
              mark_icon, mark_tint, icon_key, purge_tries) on workspace to tracker_app;
