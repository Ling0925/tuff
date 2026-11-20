/*
 * What the security review of boards found: three things an operator did to
 * a board left no line in the security log — ending it, setting a report
 * aside, and looking at one of its pictures. Each writes one now, as
 * opening, deleting and taking a picture off already did.
 */
create or replace function operator_end_board(p_board uuid)
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
  insert into security_event (id, actor_id, kind, meta)
  values (gen_random_uuid(), current_actor(), 'operator.board.end', jsonb_build_object('board', p_board));
  return ws;
end $$;

create or replace function operator_report_done(p_report uuid)
returns boolean
language plpgsql volatile security definer set search_path = public as $$
declare
  b uuid;
begin
  if not is_operator() then return false; end if;
  update scratch_report set handled_at = now() where id = p_report and handled_at is null
  returning board_id into b;
  if not found then return false; end if;
  insert into security_event (id, actor_id, kind, meta)
  values (gen_random_uuid(), current_actor(), 'operator.board.report.done', jsonb_build_object('board', b, 'report', p_report));
  return true;
end $$;

/* One of a board's pictures for an operator — where it is kept — and the
   looking written down. */
create function operator_board_picture_open(p_board uuid, p_file uuid)
returns table (storage_key text, content_type text)
language plpgsql volatile security definer set search_path = public as $$
begin
  if not is_operator() then return; end if;
  return query
    select f.storage_key, f.content_type
    from scratch_board b join file f on f.project_id = b.project_id and f.workspace_id = b.space_id
    where b.id = p_board and b.space_id is not null and f.id = p_file and f.deleted_at is null;
  if found then
    insert into security_event (id, actor_id, kind, meta)
    values (gen_random_uuid(), current_actor(), 'operator.board.picture.open', jsonb_build_object('board', p_board, 'file', p_file));
  end if;
end $$;
revoke all on function operator_board_picture_open(uuid, uuid) from public;
grant execute on function operator_board_picture_open(uuid, uuid) to tracker_app;
