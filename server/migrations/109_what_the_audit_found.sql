/*
 * What the audit of 23 October found.
 */

/* ------------------------------------------------- the clear-out never stops

   `purge_deleted` met a row it could not remove — a label still on tasks, a
   channel whose messages stayed, a message with replies — and raised, and
   the whole hourly run rolled back for every workspace, and the plan gifts
   and the orphaned files after it in the same pass were never reached. It
   now removes what it can, row by row where a whole table will not go,
   keeps what something live still names, and says how much it kept. */
create or replace function purge_deleted(p_days int default 30)
returns integer language plpgsql security definer set search_path = public as $$
declare
  t text;
  todo text[];
  left_over text[];
  moved boolean;
  n integer;
  total integer := 0;
  kept integer := 0;
  gone uuid;
  r record;
begin
  for gone in
    select id from project
    where deleted_at is not null and deleted_at < now() - (p_days || ' days')::interval
  loop
    begin
      perform purge_project_rows(gone);
      total := total + 1;
    exception when others then
      raise warning 'purge: project % could not go: %', gone, sqlerrm;
    end;
  end loop;

  select array_agg(c.table_name::text) into todo
  from information_schema.columns c
  join information_schema.tables tb
    on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
  where c.table_schema = 'public' and c.column_name = 'deleted_at';

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
      -- Row by row, keeping what something live still names.
      foreach t in array todo loop
        for r in execute format(
          'select ctid from %I where deleted_at is not null and deleted_at < now() - $1', t)
          using (p_days || ' days')::interval
        loop
          begin
            execute format('delete from %I where ctid = $1', t) using r.ctid;
            total := total + 1;
          exception when foreign_key_violation then
            kept := kept + 1;
          end;
        end loop;
      end loop;
      exit;
    end if;
  end loop;
  if kept > 0 then
    raise warning 'purge: % rows past their days are still named by something live, and stay', kept;
  end if;
  return total;
end $$;

/* A label that goes takes its place on tasks with it — the rows that named
   it were the commonest thing the clear-out could not get past. */
alter table task_label drop constraint task_label_label_id_fkey;
alter table task_label add constraint task_label_label_id_fkey
  foreign key (label_id) references label(id) on delete cascade;

/* ------------------------------------- somebody who left stays in the record

   A person was readable only through a membership that had not ended, so
   the day somebody left, or their account was deleted, everything they had
   said went from every list that reads a name beside it: messages,
   comments, posts, files, hours, and their tasks answered 404. Having been
   a member is enough to be named in the record of the place. */
drop policy a_read on actor;
create policy a_read on actor for select using (
  id = current_actor()
  or exists (
    select 1 from membership m
    where m.actor_id = actor.id
      and role_in(m.workspace_id) in ('owner', 'admin', 'member')
  )
  or exists (
    select 1 from project_member mine
    join project pr on pr.id = mine.project_id
     and (current_workspace() is null or pr.workspace_id = current_workspace())
    join project_member theirs on theirs.project_id = mine.project_id
      and theirs.deleted_at is null
    where mine.actor_id = current_actor() and mine.deleted_at is null
      and theirs.actor_id = actor.id
  )
);

/* A deleted account is a name in the record, not a row to clear out: its
   actor is kept as "Deleted account" without `deleted_at`, which the
   clear-out would have tried to remove from under everything it said. */
update actor a set deleted_at = null
where a.deleted_at is not null and a.name = 'Deleted account'
  and not exists (select 1 from app_user u where u.actor_id = a.id);

create or replace function operator_delete_account(p_actor uuid, p_dry boolean default false) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_alone json;
  v_blocked json;
  v_leaves json;
  w record;
  t text;
  todo text[];
  left_over text[];
  moved boolean;
begin
  if not is_operator() or not exists (select 1 from app_user where actor_id = p_actor) then
    return json_build_object('ok', false, 'why', 'not_found');
  end if;
  if p_actor = current_actor() then
    return json_build_object('ok', false, 'why', 'self');
  end if;
  if exists (select 1 from operator where actor_id = p_actor) then
    return json_build_object('ok', false, 'why', 'operator');
  end if;

  drop table if exists owned;
  create temporary table owned on commit drop as
  select ws.id, ws.name, ws.icon_key,
         (select count(*) from membership o
          where o.workspace_id = ws.id and o.actor_id <> p_actor
            and o.deleted_at is null and o.joined_at is not null)::int as others,
         exists (select 1 from membership o
                 where o.workspace_id = ws.id and o.actor_id <> p_actor and o.role = 'owner'
                   and o.deleted_at is null and o.joined_at is not null) as co_owned
  from workspace ws
  join membership m on m.workspace_id = ws.id
  where m.actor_id = p_actor and m.role = 'owner' and m.deleted_at is null and ws.deleted_at is null;

  select json_agg(json_build_object('id', id, 'name', name) order by name) into v_alone
  from owned where others = 0;
  select json_agg(json_build_object('id', id, 'name', name, 'people', others) order by name) into v_blocked
  from owned where others > 0 and not co_owned;
  select json_agg(json_build_object('id', ws.id, 'name', ws.name) order by ws.name) into v_leaves
  from workspace ws join membership m on m.workspace_id = ws.id
  where m.actor_id = p_actor and m.deleted_at is null and ws.deleted_at is null
    and ws.id not in (select id from owned where others = 0);

  if p_dry or v_blocked is not null then
    return json_build_object(
      'ok', v_blocked is null and p_dry,
      'why', case when v_blocked is not null then 'sole_owner' end,
      'alone', coalesce(v_alone, '[]'::json),
      'blocked', coalesce(v_blocked, '[]'::json),
      'leaves', coalesce(v_leaves, '[]'::json));
  end if;

  for w in select id, icon_key from owned where others = 0 loop
    if w.icon_key is not null then
      insert into storage_orphan (key) values (w.icon_key) on conflict do nothing;
    end if;
    perform purge_workspace(w.id);
  end loop;

  update membership set deleted_at = now() where actor_id = p_actor and deleted_at is null;
  update project_member set deleted_at = now() where actor_id = p_actor and deleted_at is null;

  delete from refresh_session where actor_id = p_actor;
  update api_token set revoked_at = now() where actor_id = p_actor and revoked_at is null;
  delete from push_subscription where actor_id = p_actor;
  delete from auth_identity where actor_id = p_actor;
  delete from auth_ticket where actor_id = p_actor;
  delete from app_user where actor_id = p_actor;
  insert into storage_orphan (key)
  select avatar_key from actor where id = p_actor and avatar_key is not null
  on conflict do nothing;
  update actor
  set name = 'Deleted account', title = null, avatar_url = null, avatar_key = null, updated_at = now()
  where id = p_actor;

  if not exists (select 1 from membership where actor_id = p_actor) then
    select array_agg(table_name::text) into todo
    from information_schema.columns
    where table_schema = 'public' and column_name = 'actor_id' and table_name <> 'actor';
    loop
      moved := false;
      left_over := '{}';
      foreach t in array todo loop
        begin
          execute format('delete from %I where actor_id = $1', t) using p_actor;
          moved := true;
        exception when foreign_key_violation then
          left_over := left_over || t;
        end;
      end loop;
      todo := left_over;
      exit when cardinality(todo) = 0;
      if not moved then exit; end if;
    end loop;
    begin
      delete from actor where id = p_actor;
    exception when foreign_key_violation then
      null;
    end;
  end if;

  return json_build_object('ok', true, 'alone', coalesce(v_alone, '[]'::json), 'leaves', coalesce(v_leaves, '[]'::json));
end $$;

/* -------------------------------------------------- a device is one line, again

   Switching workspace ended the session it came from (108's answer to a
   list of fifteen devices), and every other tab of that browser was using
   the same session — so switching in one tab signed the others out at
   their next refresh. Sessions are kept; the browser names itself instead,
   and the list is one line a browser, however many sessions its tabs and
   workspaces hold. Signing a line out ends all of them. */
alter table refresh_session add column if not exists device text;
create index if not exists refresh_session_device on refresh_session (actor_id, device) where revoked_at is null;

drop function if exists auth_sessions(uuid);
create function auth_sessions(p_actor uuid)
returns table (id uuid, device text, user_agent text, ip text, created_at timestamptz,
               last_used_at timestamptz, expires_at timestamptz, sessions int)
language sql stable security definer set search_path = public as $$
  with live as (
    select s.*, coalesce(s.device, s.id::text) as line
    from refresh_session s
    where s.actor_id = p_actor and s.revoked_at is null and s.expires_at > now()
  ),
  newest as (
    select distinct on (line) * from live order by line, created_at desc
  )
  select n.id, n.device, n.user_agent, n.ip, n.created_at, n.last_used_at, n.expires_at,
         (select count(*)::int from live l where l.line = n.line)
  from newest n
  order by n.created_at desc
$$;
grant execute on function auth_sessions(uuid) to tracker_app;

/* One line out: every session of the browser that line is. */
create or replace function auth_revoke_session(p_actor uuid, p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_device text;
  hit int;
begin
  select device into v_device from refresh_session where id = p_id and actor_id = p_actor;
  with ended as (
    update refresh_session set revoked_at = now()
    where actor_id = p_actor and revoked_at is null
      and (id = p_id or (v_device is not null and device = v_device))
    returning 1
  )
  select count(*) into hit from ended;
  return hit > 0;
end $$;

/* Every other browser out; every session of the one asking kept. */
create or replace function auth_revoke_others(p_actor uuid, p_keep uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_device text;
  n int;
begin
  select device into v_device from refresh_session where id = p_keep and actor_id = p_actor;
  with ended as (
    update refresh_session set revoked_at = now()
    where actor_id = p_actor and id <> p_keep and revoked_at is null
      and (v_device is null or device is distinct from v_device)
    returning 1
  )
  select count(*)::int into n from ended;
  return n;
end $$;

/* ---------------------------------------- a confirmation link and its browser

   The link from the confirmation mail signed in whoever followed it, so an
   attacker's own link sent to somebody already signed in replaced their
   session with the attacker's account — anything they wrote next went to
   the attacker. It signs in only the browser that signed up (a cookie set
   then, its hash kept as a `bind` ticket); anywhere else it confirms the
   address and asks for the password. */
alter table auth_ticket drop constraint auth_ticket_kind_check;
alter table auth_ticket add constraint auth_ticket_kind_check
  check (kind in ('reset', 'handoff', 'verify', 'bind'));

/* Which browser a session is, for saying which line is "this device". */
create function auth_device_of(p_actor uuid, p_session uuid) returns text
language sql stable security definer set search_path = public as $$
  select device from refresh_session where id = p_session and actor_id = p_actor
$$;
grant execute on function auth_device_of(uuid, uuid) to tracker_app;

/* ------------------------------------------- what a row names is its own place

   A task could be put in another project's list or sprint, a file in
   another project's folder, a reply under a message of another room —
   the foreign key checks that the row exists, not where. Ids from another
   company were accepted that way (the key ignores row-level security),
   the move answered whether an id existed elsewhere, and deleting the
   other project for good then failed on the stray reference. Checked here,
   for every path that writes — the API, the importers, the seed — and
   refused as a `check_violation` the API answers as a 400. */
create function task_stays_in_its_project() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.list_id is not null
     and not exists (select 1 from task_list where id = new.list_id and project_id = new.project_id) then
    raise exception 'a list from another project' using errcode = 'check_violation';
  end if;
  if new.cycle_id is not null
     and not exists (select 1 from cycle where id = new.cycle_id and project_id = new.project_id) then
    raise exception 'a sprint from another project' using errcode = 'check_violation';
  end if;
  if new.parent_id is not null
     and not exists (select 1 from task where id = new.parent_id and project_id = new.project_id) then
    raise exception 'a task from another project' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger task_stays_in_its_project
  before insert or update of list_id, cycle_id, parent_id, project_id on task
  for each row execute function task_stays_in_its_project();

create function file_stays_in_its_project() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.folder_id is not null
     and not exists (select 1 from file where id = new.folder_id and project_id = new.project_id) then
    raise exception 'a folder from another project' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger file_stays_in_its_project
  before insert or update of folder_id, project_id on file
  for each row execute function file_stays_in_its_project();

create function message_stays_in_its_room() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.parent_id is not null
     and not exists (select 1 from message where id = new.parent_id and conversation_id = new.conversation_id) then
    raise exception 'a message from another room' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger message_stays_in_its_room
  before insert or update of parent_id, conversation_id on message
  for each row execute function message_stays_in_its_room();

create function comment_stays_on_its_thing() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.parent_id is not null
     and not exists (select 1 from comment
                     where id = new.parent_id and object_type = new.object_type and object_id = new.object_id) then
    raise exception 'a comment on something else' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger comment_stays_on_its_thing
  before insert or update of parent_id, object_id on comment
  for each row execute function comment_stays_on_its_thing();

/* --------------------------------------------------------- the rest

   A zone nobody's clock knows, kept before zones were checked, is UTC. */
update app_user set timezone = 'UTC'
where timezone not in (select name from pg_timezone_names);

/* A window is swept when it has ended, not when it is ten minutes old: the
   day-long ceiling on invitations by mail started again every sweep. */
drop function rate_sweep(interval);
create function rate_sweep(p_older_than interval default interval '1 day 1 minute')
returns void language sql security definer set search_path = public as $$
  delete from rate_window where window_start < now() - p_older_than
$$;
grant execute on function rate_sweep(interval) to tracker_app;

/* A token for some projects only reached all of the person's: the list was
   kept and never read. Making one is refused now; the ones made before go. */
update api_token set revoked_at = now()
where revoked_at is null and cardinality(project_ids) > 0;

/* Bytes a picture leaves behind when it is changed or taken off are queued
   for removal, as a deleted file's are: an avatar uploaded again and again
   was storage nobody counted and nothing ever freed. */
create function picture_bytes_go_with_it() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  was text;
  now_ text;
begin
  was := to_jsonb(old) ->> tg_argv[0];
  now_ := to_jsonb(new) ->> tg_argv[0];
  if was is not null and was is distinct from now_ then
    insert into storage_orphan (key) values (was) on conflict do nothing;
  end if;
  return new;
end $$;
create trigger avatar_bytes_go_with_it after update of avatar_key on actor
  for each row execute function picture_bytes_go_with_it('avatar_key');
create trigger project_icon_bytes_go_with_it after update of icon_key on project
  for each row execute function picture_bytes_go_with_it('icon_key');
create trigger workspace_icon_bytes_go_with_it after update of icon_key on workspace
  for each row execute function picture_bytes_go_with_it('icon_key');
create trigger display_bytes_go_with_it after update of display_key on file
  for each row execute function picture_bytes_go_with_it('display_key');

/* Webhooks hear what everybody does, not only the owner: the queue was
   read as whoever acted, and only an owner may read the webhooks. */
create function queue_webhooks(p_workspace uuid, p_event text, p_payload jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if current_workspace() is not null and p_workspace <> current_workspace() then
    return 0;
  end if;
  insert into webhook_delivery (id, workspace_id, webhook_id, event, payload)
  select gen_random_uuid(), p_workspace, w.id, p_event, p_payload
  from webhook w
  where w.workspace_id = p_workspace and w.enabled and w.deleted_at is null
    and (cardinality(w.events) = 0 or p_event = any(w.events));
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function queue_webhooks(uuid, text, jsonb) to tracker_app;

/* A message brought from Slack in a colleague's name: the insert policy
   asks that whoever writes a message is its author, so the first message
   by anybody but the importer failed the whole import. Written here, as
   the importer, into a room they can see, by a member of this workspace. */
create function import_message(
  p_id uuid, p_workspace uuid, p_conversation uuid, p_author uuid, p_parent uuid,
  p_body jsonb, p_said_as text, p_at timestamptz
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if current_actor() is null or p_workspace is distinct from current_workspace() then
    raise exception 'not here' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from conversation where id = p_conversation and workspace_id = p_workspace)
     or not can_see_conversation(p_conversation) then
    raise exception 'not a room you can see' using errcode = 'insufficient_privilege';
  end if;
  if p_author <> current_actor() and not exists (
    select 1 from membership where workspace_id = p_workspace and actor_id = p_author
      and deleted_at is null and joined_at is not null) then
    raise exception 'not somebody here' using errcode = 'insufficient_privilege';
  end if;
  insert into message (id, workspace_id, conversation_id, author_id, parent_id, body,
                       origin, said_as, created_at, updated_at)
  values (p_id, p_workspace, p_conversation, p_author, p_parent, p_body,
          'import', p_said_as, p_at, p_at);
end $$;
grant execute on function import_message(uuid, uuid, uuid, uuid, uuid, jsonb, text, timestamptz) to tracker_app;
