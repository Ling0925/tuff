/*
 * A project in the bin can be deleted for good — now, by the owner, or by
 * the thirty-day clear-out — and its files' bytes go with it.
 * `docs/specs/projects-index.md`.
 */

/* ------------------------------------------------------------ the bytes */

/*
 * Keys of stored bytes whose rows are gone, for the worker to remove.
 *
 * Queued by the rows themselves as they are deleted, whoever deletes them,
 * so a clear-out and a delete-for-good and anything after them all leave
 * the same trail. Nothing removed the bytes before: a file purged from the
 * database stayed in the bucket for ever.
 */
create table storage_orphan (
  key text primary key,
  queued_at timestamptz not null default now()
);
alter table storage_orphan enable row level security;
revoke all on storage_orphan from tracker_app;

create function file_bytes_go_with_it() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into storage_orphan (key)
  select k from unnest(array[old.storage_key, old.display_key]) k where k is not null
  on conflict do nothing;
  return old;
end $$;
create trigger file_bytes_go_with_it after delete on file
  for each row execute function file_bytes_go_with_it();

create function project_icon_goes_with_it() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.icon_key is not null then
    insert into storage_orphan (key) values (old.icon_key) on conflict do nothing;
  end if;
  return old;
end $$;
create trigger project_icon_goes_with_it after delete on project
  for each row execute function project_icon_goes_with_it();

/*
 * The next keys nothing points at any more. A key some row still names —
 * the same bytes behind two rows — is taken off the queue and kept.
 */
create function storage_orphans(p_limit int) returns setof text
language plpgsql security definer set search_path = public as $$
begin
  delete from storage_orphan o
  where exists (select 1 from file f where f.storage_key = o.key or f.display_key = o.key)
     or exists (select 1 from project p where p.icon_key = o.key)
     or exists (select 1 from workspace w where w.icon_key = o.key)
     or exists (select 1 from actor a where a.avatar_key = o.key);
  return query select key from storage_orphan order by queued_at limit greatest(p_limit, 1);
end $$;
grant execute on function storage_orphans(int) to tracker_app;

/* And the ones removed, off the queue. */
create function storage_orphans_gone(p_keys text[]) returns void
language sql security definer set search_path = public as $$
  delete from storage_orphan where key = any(p_keys)
$$;
grant execute on function storage_orphans_gone(text[]) to tracker_app;

/* -------------------------------------------------------- the project */

/*
 * Everything a project held, removed, children before what they hang from,
 * and whatever pointed at any of it by id alone. Asks nobody: it is called
 * by the checked door below and by the clear-out, never by a request.
 */
create function purge_project_rows(p uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  rooms uuid[];
  tasks uuid[];
  things uuid[];
begin
  select coalesce(array_agg(id), '{}') into rooms from conversation where project_id = p;
  select coalesce(array_agg(id), '{}') into tasks from task where project_id = p;
  things := tasks || rooms
    || coalesce((select array_agg(id) from post where project_id = p), '{}')
    || coalesce((select array_agg(id) from file where project_id = p or conversation_id = any(rooms)), '{}');

  delete from message where conversation_id = any(rooms);
  delete from conversation_member where conversation_id = any(rooms);
  delete from task_label where task_id = any(tasks) or label_id in (select id from label where project_id = p);
  delete from time_entry where project_id = p;
  delete from comment where project_id = p or object_id = any(things);
  delete from subscription where object_id = any(things);
  delete from notification where object_id = any(things);
  delete from object_link where from_id = any(things) or to_id = any(things);
  delete from sidebar_place where object_id = p or object_id = any(rooms);
  delete from activity_event where project_id = p or object_id = any(things);
  delete from task where project_id = p;
  delete from file where project_id = p or conversation_id = any(rooms);
  delete from conversation where id = any(rooms);
  delete from task_list where project_id = p;
  delete from cycle where project_id = p;
  delete from label where project_id = p;
  delete from post where project_id = p;
  delete from project_member where project_id = p;
  /* An invite still naming it would fail on being accepted, adding its
     person to a project that is not there. A token keeps the name: taking
     the last one off would leave a list that is empty, and an empty list is
     a token for every project. */
  update invite set project_ids = array_remove(project_ids, p) where p = any(project_ids);
  delete from project where id = p;
end $$;

/* The door a request uses: a project already in the bin, of a workspace
   the asker owns. Anything else answers false and touches nothing. */
create function purge_project(p uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  ws uuid;
  said text;
begin
  select pr.workspace_id, pr.name into ws, said from project pr
  where pr.id = p and pr.deleted_at is not null
    and (current_workspace() is null or pr.workspace_id = current_workspace())
    and role_in(pr.workspace_id) = 'owner';
  if ws is null then
    return false;
  end if;
  perform purge_project_rows(p);
  /* Said in the security log, which outlives the project — the feed went
     with it. */
  insert into security_event (id, workspace_id, actor_id, kind, meta)
  values (gen_random_uuid(), ws, current_actor(), 'project.purged', jsonb_build_object('name', said));
  return true;
end $$;
grant execute on function purge_project(uuid) to tracker_app;

/*
 * The clear-out, which takes a project in the bin past its days whole
 * first. It could not before: a project's tasks were never deleted with
 * it, so its row could not go — and meeting a row it could not remove, the
 * loop below gave up on everything else as well.
 */
create or replace function purge_deleted(p_days int default 30)
returns integer language plpgsql security definer set search_path = public as $$
declare
  t text;
  todo text[];
  left_over text[];
  moved boolean;
  n integer;
  total integer := 0;
  gone uuid;
begin
  for gone in
    select id from project
    where deleted_at is not null and deleted_at < now() - (p_days || ' days')::interval
  loop
    perform purge_project_rows(gone);
    total := total + 1;
  end loop;

  select array_agg(table_name::text) into todo
  from information_schema.columns
  where table_schema = 'public' and column_name = 'deleted_at';

  loop
    moved := false;
    left_over := '{}';
    foreach t in array todo loop
      begin
        execute format(
          'delete from %I where deleted_at is not null and deleted_at < now() - $1', t)
          using (p_days || ' days')::interval;
        get diagnostics n = row_count;
        total := total + n;
        moved := true;
      exception when foreign_key_violation then
        left_over := left_over || t;
      end;
    end loop;
    todo := left_over;
    exit when cardinality(todo) = 0;
    if not moved then
      raise exception 'could not clear: %', todo;
    end if;
  end loop;
  return total;
end $$;
