/*
 * An operator deletes a board at once.
 * Not ended and left for the clear-out: gone now, by the
 * clear-out's own path (`purge_workspace`), with its tasks, comments,
 * pictures and agents' names; the bytes of its pictures queued for the
 * worker by the triggers that queue any file's. Only ever a board's own
 * workspace — the function finds it from the board and refuses one that is
 * not marked `scratch` — so a project a board was saved into, which lives in
 * a real workspace, is never touched. Written to the security log: who,
 * which board, when.
 */
create function operator_board_delete(p_board uuid) returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare
  b scratch_board%rowtype;
  who uuid[];
begin
  if not is_operator() then return null; end if;
  select * into b from scratch_board where id = p_board for update;
  if not found or b.space_id is null then return null; end if;
  if not exists (select 1 from workspace w where w.id = b.space_id and w.scratch) then
    raise exception 'operator_board_delete: not a board''s workspace' using errcode = '42501';
  end if;
  select coalesce(array_agg(actor_id), '{}') || b.guest_id into who
  from scratch_agent where workspace_id = b.space_id;
  update scratch_board set ended_at = coalesce(ended_at, now()), ended_by = 'operator',
                           expires_at = least(expires_at, now())
  where id = b.id;
  update scratch_report set handled_at = now() where board_id = b.id and handled_at is null;
  insert into security_event (id, actor_id, kind, meta)
  values (gen_random_uuid(), current_actor(), 'operator.board.delete', jsonb_build_object('board', b.id));
  perform purge_workspace(b.space_id);
  delete from actor where id = any(who);
  return b.space_id;
end $$;
revoke all on function operator_board_delete(uuid) from public;
grant execute on function operator_board_delete(uuid) to tracker_app;
