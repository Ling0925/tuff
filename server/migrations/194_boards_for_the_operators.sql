/*
 * Boards in the operators' admin, a switch for them, and the country one
 * was started from.
 *
 * The operators see every board: when it was started and last changed,
 * what is on it, who saved it where, what was reported. Never its links —
 * only their hashes are kept, and an admin that held every board's edit
 * link would be the one place to steal them all from. An operator opens a
 * board by its id, read-only, and that opening is written to the security
 * log as an operator's access.
 *
 * The country is the two letters Cloudflare says a request came from,
 * taken only when the request is proven to have come through Cloudflare;
 * never the address.
 */

alter table scratch_board add column country text check (country ~ '^[A-Z]{2}$');

drop function board_start(text, text, text, text[], text, int, int, text);
create function board_start(
  p_edit text, p_view text, p_name text, p_lists text[], p_guest text,
  p_days int, p_most_days int, p_source text, p_country text
) returns table (board_id uuid, workspace_id uuid, project_id uuid, guest_id uuid)
language plpgsql volatile security definer set search_path = public as $$
declare
  b uuid := gen_random_uuid();
  ws uuid := gen_random_uuid();
  pr uuid := gen_random_uuid();
  guest uuid := gen_random_uuid();
  icons text[] := array['open', 'doing', 'done'];
  colors text[] := array['blue', 'orange', 'green'];
  i int;
begin
  if cardinality(p_lists) <> 3 or p_days < 1 or p_most_days < p_days then
    raise exception 'board_start: bad arguments' using errcode = '22023';
  end if;
  insert into workspace (id, name, slug, scratch)
  values (ws, left(p_name, 200), 'b-' || replace(ws::text, '-', ''), true);
  insert into actor (id, name) values (guest, left(p_guest, 60));
  insert into membership (id, workspace_id, actor_id, role, joined_at)
  values (gen_random_uuid(), ws, guest, 'member', now());
  insert into project (id, workspace_id, name, tools)
  values (pr, ws, left(p_name, 200), '{tasks}');
  insert into project_member (id, workspace_id, project_id, actor_id, added_by, rights)
  values (gen_random_uuid(), ws, pr, guest, guest, '{task.create}');
  for i in 1..3 loop
    insert into task_list (id, workspace_id, project_id, author_id, name, sort_key, icon, finishes, color)
    values (gen_random_uuid(), ws, pr, guest, left(p_lists[i], 60), 'a' || (i - 1), icons[i], i = 3, colors[i]);
  end loop;
  insert into scratch_board (id, space_id, project_id, guest_id, edit_hash, view_hash,
                             expires_at, ends_by, source, country)
  values (b, ws, pr, guest, p_edit, p_view,
          now() + make_interval(days => p_days), now() + make_interval(days => p_most_days),
          nullif(left(coalesce(p_source, ''), 40), ''),
          case when p_country ~ '^[A-Z]{2}$' then p_country end);
  return query select b, ws, pr, guest;
end $$;
revoke all on function board_start(text, text, text, text[], text, int, int, text, text) from public;
grant execute on function board_start(text, text, text, text[], text, int, int, text, text) to tracker_app;

/* ----------------------------------------------------------- the switch */

/* Boards on or off, said by an operator and kept here: one row. */
create table board_switch (
  only_one   boolean primary key default true check (only_one),
  off        boolean not null default false,
  changed_at timestamptz not null default now(),
  changed_by uuid references actor(id) on delete set null
);
insert into board_switch (only_one, off) values (true, false);
alter table board_switch enable row level security;

/* Whether new boards and board traffic are off — read by every request,
   cached for seconds. */
create function boards_off() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select off from board_switch), false)
$$;
revoke all on function boards_off() from public;
grant execute on function boards_off() to tracker_app;

create function operator_board_switch(p_off boolean) returns boolean
language plpgsql volatile security definer set search_path = public as $$
begin
  if not is_operator() then return false; end if;
  update board_switch set off = p_off, changed_at = now(), changed_by = current_actor();
  insert into security_event (id, actor_id, kind, meta)
  values (gen_random_uuid(), current_actor(), case when p_off then 'boards.off' else 'boards.on' end, '{}'::jsonb);
  return true;
end $$;
revoke all on function operator_board_switch(boolean) from public;
grant execute on function operator_board_switch(boolean) to tracker_app;

/* ------------------------------------------------------------- the list */

/*
 * Every board, newest first, a page at a time by (created_at, id). What is
 * on it is counted from its rows while it stands, and from its own counters
 * once it is cleared.
 */
create function operator_board_list(p_before_at timestamptz, p_before_id uuid, p_limit int)
returns table (
  id uuid, created_at timestamptz, last_write_at timestamptz, expires_at timestamptz,
  status text, name text, tasks int, comments int, agents json, saved_into json, reports int,
  country text, source text
)
language sql stable security definer set search_path = public as $$
  select b.id, b.created_at, b.last_write_at, b.expires_at,
         case when b.space_id is null then 'cleared'
              when b.ended_by = 'operator' then 'ended'
              when b.saved_at is not null then 'saved'
              when b.ended_at is not null or b.expires_at < now() then 'expired'
              else 'live' end,
         p.name,
         case when b.space_id is null then b.tasks_made
              else (select count(*)::int from task t where t.project_id = b.project_id and t.deleted_at is null) end,
         b.comments_made,
         coalesce((select json_agg(a.name order by a.created_at) from scratch_agent a where a.workspace_id = b.space_id), '[]'),
         case when b.saved_workspace_id is null then null
              else (select json_build_object('id', w.id, 'name', w.name, 'slug', w.slug::text)
                    from workspace w where w.id = b.saved_workspace_id) end,
         (select count(*)::int from scratch_report r where r.board_id = b.id),
         b.country, b.source
  from scratch_board b
  left join project p on p.id = b.project_id
  where is_operator()
    and (p_before_at is null or (b.created_at, b.id) < (p_before_at, p_before_id))
  order by b.created_at desc, b.id desc
  limit least(greatest(p_limit, 1), 100)
$$;
revoke all on function operator_board_list(timestamptz, uuid, int) from public;
grant execute on function operator_board_list(timestamptz, uuid, int) to tracker_app;

/*
 * One board, read-only, for an operator: its lists and tasks with their
 * comments counted — and the opening written to the security log.
 */
create function operator_board_open(p_board uuid) returns json
language plpgsql volatile security definer set search_path = public as $$
declare
  b scratch_board%rowtype;
  out json;
begin
  if not is_operator() then return null; end if;
  select * into b from scratch_board where id = p_board;
  if not found or b.space_id is null then return null; end if;
  insert into security_event (id, actor_id, kind, meta)
  values (gen_random_uuid(), current_actor(), 'operator.board.open', jsonb_build_object('board', p_board));
  select json_build_object(
    'id', b.id,
    'name', (select name from project where id = b.project_id),
    'lists', coalesce((select json_agg(json_build_object('id', l.id, 'name', l.name) order by l.sort_key)
                       from task_list l where l.project_id = b.project_id and l.deleted_at is null), '[]'),
    'tasks', coalesce((select json_agg(json_build_object(
                         'number', t.number, 'title', t.title, 'list_id', t.list_id,
                         'by', (select a.name from actor a where a.id = t.author_id),
                         'has', (select string_agg(a.name, ', ') from actor a where a.id = any(t.assignee_ids)),
                         'comments', (select count(*) from comment c where c.object_type = 'task' and c.object_id = t.id and c.deleted_at is null)
                       ) order by t.sort_key, t.id)
                       from task t where t.project_id = b.project_id and t.deleted_at is null and t.parent_id is null), '[]')
  ) into out;
  return out;
end $$;
revoke all on function operator_board_open(uuid) from public;
grant execute on function operator_board_open(uuid) to tracker_app;

/* The numbers gain where boards were started from, and whether they are off. */
create or replace function operator_boards()
returns json
language sql stable security definer set search_path = public as $$
  select case when not is_operator() then null else json_build_object(
    'today', (select count(*) from scratch_board where created_at > now() - interval '1 day'),
    'week', (select count(*) from scratch_board where created_at > now() - interval '7 days'),
    'month', (select count(*) from scratch_board where created_at > now() - interval '30 days'),
    'all', (select count(*) from scratch_board),
    'open', (select count(*) from scratch_board where space_id is not null and ended_at is null and expires_at >= now()),
    'agent_hour', (select count(*) from scratch_board where first_agent_at < created_at + interval '1 hour'),
    'agent', (select count(*) from scratch_board where first_agent_at is not null),
    'ten_tasks', (select count(*) from scratch_board where tasks_made >= 10),
    'second_day', (select count(*) from scratch_board where last_write_at > created_at + interval '1 day'),
    'saved', (select count(*) from scratch_board where saved_at is not null),
    'off', boards_off(),
    'saved_plans', coalesce((
      select json_object_agg(plan, n) from (
        select w.plan, count(*) as n from scratch_board b join workspace w on w.id = b.saved_workspace_id
        where b.saved_at is not null group by w.plan) x), '{}'),
    'sources', coalesce((
      select json_object_agg(s, n) from (
        select coalesce(source, '') as s, count(*) as n from scratch_board
        where created_at > now() - interval '30 days' group by 1) x), '{}'),
    'countries', coalesce((
      select json_object_agg(c, n) from (
        select coalesce(country, '') as c, count(*) as n from scratch_board
        where created_at > now() - interval '30 days' group by 1 order by 2 desc) x), '{}'),
    'reports', coalesce((
      select json_agg(json_build_object(
        'id', r.id, 'board_id', r.board_id, 'reason', r.reason, 'contact', r.contact,
        'at', r.created_at, 'name', p.name, 'live', b.space_id is not null and b.ended_at is null
      ) order by r.created_at desc)
      from (select * from scratch_report where handled_at is null order by created_at desc limit 100) r
      join scratch_board b on b.id = r.board_id
      left join project p on p.id = b.project_id), '[]')
  ) end
$$;
