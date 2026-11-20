/*
 * Pictures on a board. Ten at
 * most, two megabytes each, and their bytes counted against the board's own
 * budget of twenty megabytes, spent in the statement that checks it. They are
 * file rows of the board's own project, in its own workspace, so the
 * clear-out that removes a board removes them and queues their bytes
 * (`file_bytes_go_with_it`).
 */
alter table scratch_board add column bytes_used bigint not null default 0;

create function board_spend_bytes(p_hash text, p_bytes bigint, p_most bigint)
returns boolean
language plpgsql volatile security definer set search_path = public as $$
begin
  update scratch_board set bytes_used = bytes_used + greatest(p_bytes, 0)
  where edit_hash = p_hash and space_id is not null and ended_at is null and saved_at is null
    and expires_at >= now() and bytes_used + greatest(p_bytes, 0) <= p_most;
  return found;
end $$;
revoke all on function board_spend_bytes(text, bigint, bigint) from public;
grant execute on function board_spend_bytes(text, bigint, bigint) to tracker_app;

/* An operator takes a picture off a board, and it is written down. */
create function operator_board_picture_remove(p_board uuid, p_file uuid) returns boolean
language plpgsql volatile security definer set search_path = public as $$
declare
  b scratch_board%rowtype;
begin
  if not is_operator() then return false; end if;
  select * into b from scratch_board where id = p_board;
  if not found or b.space_id is null then return false; end if;
  delete from file where id = p_file and project_id = b.project_id and workspace_id = b.space_id;
  if not found then return false; end if;
  insert into security_event (id, actor_id, kind, meta)
  values (gen_random_uuid(), current_actor(), 'operator.board.picture.remove', jsonb_build_object('board', p_board, 'file', p_file));
  return true;
end $$;
revoke all on function operator_board_picture_remove(uuid, uuid) from public;
grant execute on function operator_board_picture_remove(uuid, uuid) to tracker_app;

/* A board's pictures, for an operator's read-only view: where each is kept,
   so the operator's route can hand the bytes over. */
create function operator_board_pictures(p_board uuid)
returns table (id uuid, storage_key text, content_type text, size_bytes bigint, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select f.id, f.storage_key, f.content_type, f.size_bytes, f.created_at
  from scratch_board b join file f on f.project_id = b.project_id and f.workspace_id = b.space_id
  where is_operator() and b.id = p_board and b.space_id is not null and f.deleted_at is null
  order by f.created_at
$$;
revoke all on function operator_board_pictures(uuid) from public;
grant execute on function operator_board_pictures(uuid) to tracker_app;

/* And what a board's contents carry for saving: which pictures it holds. */
create function board_pictures(p_hash text)
returns table (id uuid, storage_key text, content_type text, name text, size_bytes bigint, pixel_width int, pixel_height int)
language sql stable security definer set search_path = public as $$
  select f.id, f.storage_key, f.content_type, f.name, f.size_bytes, f.pixel_width, f.pixel_height
  from scratch_board b join file f on f.project_id = b.project_id and f.workspace_id = b.space_id
  where b.edit_hash = p_hash and b.space_id is not null and b.saved_at is null
    and b.ended_by is distinct from 'operator' and f.deleted_at is null
$$;
revoke all on function board_pictures(text) from public;
grant execute on function board_pictures(text) to tracker_app;
