/*
 * A board by link, for agents.
 *
 * Each board is a workspace of its own, marked `scratch`, with one project,
 * three lists and ordinary tasks. Row-level security keys every row on the
 * session's workspace, so a board's credential reaches its board and
 * nothing else — not another board and not a company — without a policy
 * written or weakened here.
 *
 * What is about the board rather than its tasks — the two secrets' hashes,
 * when it goes, the numbers the operators read — is in `scratch_board`,
 * which the application role cannot select: everything goes through the
 * definer functions below, and each one is keyed on a secret's hash rather
 * than on an id, so nothing that reaches them without the secret can name
 * a board.
 */

alter table workspace add column scratch boolean not null default false;

/*
 * Not `workspace_id`: the clear-out removes every row with that column
 * (`purge_workspace`), and the board's own row outlives its workspace as
 * the line the numbers are counted from — with no words of anybody's in it.
 * `space_id` goes to null when the workspace is cleared.
 */
create table scratch_board (
  id                 uuid primary key,
  space_id           uuid unique references workspace(id) on delete set null,
  project_id         uuid not null,
  guest_id           uuid not null,
  edit_hash          text not null unique,
  view_hash          text not null unique,
  created_at         timestamptz not null default now(),
  last_write_at      timestamptz not null default now(),
  expires_at         timestamptz not null,
  ends_by            timestamptz not null,
  first_agent_at     timestamptz,
  tasks_made         integer not null default 0,
  saved_at           timestamptz,
  saved_project_id   uuid,
  saved_workspace_id uuid,
  ended_at           timestamptz,
  ended_by           text check (ended_by in ('expired', 'operator')),
  source             text check (char_length(source) <= 40)
);
create index scratch_board_due on scratch_board (expires_at) where ended_at is null;
create index scratch_board_gone on scratch_board (ended_at) where space_id is not null and ended_at is not null;
create index scratch_board_made on scratch_board (created_at);
alter table scratch_board enable row level security;

/* The names agents gave themselves, each an actor on the board. With the
   workspace's column, so the clear-out takes it with the rest. */
create table scratch_agent (
  workspace_id uuid not null references workspace(id),
  actor_id     uuid not null references actor(id),
  name         text not null check (char_length(name) between 1 and 60),
  created_at   timestamptz not null default now(),
  primary key (workspace_id, actor_id)
);
create unique index scratch_agent_name on scratch_agent (workspace_id, lower(name));
alter table scratch_agent enable row level security;

/* What somebody reported about a board, for the operators' queue. */
create table scratch_report (
  id         uuid primary key,
  board_id   uuid not null references scratch_board(id),
  reason     text not null check (char_length(reason) between 1 and 2000),
  contact    text check (char_length(contact) <= 200),
  created_at timestamptz not null default now(),
  handled_at timestamptz
);
create index scratch_report_open on scratch_report (created_at) where handled_at is null;
alter table scratch_report enable row level security;

/* ------------------------------------------------------------- starting */

create function board_start(
  p_edit text, p_view text, p_name text, p_lists text[], p_guest text,
  p_days int, p_most_days int, p_source text
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
                             expires_at, ends_by, source)
  values (b, ws, pr, guest, p_edit, p_view,
          now() + make_interval(days => p_days), now() + make_interval(days => p_most_days),
          nullif(left(coalesce(p_source, ''), 40), ''));
  return query select b, ws, pr, guest;
end $$;
revoke all on function board_start(text, text, text, text[], text, int, int, text) from public;
grant execute on function board_start(text, text, text, text[], text, int, int, text) to tracker_app;

/* ------------------------------------------------------------- finding */

/*
 * The board a secret opens, and whether it was the edit one. A board whose
 * workspace has been cleared answers nothing; one that has ended — its
 * date passed, or an operator ended it — answers with `ended`, so the page
 * can say so and Save can still be offered for the days it is kept.
 */
create function board_find(p_hash text)
returns table (
  board_id uuid, workspace_id uuid, project_id uuid, guest_id uuid, edit boolean, name text,
  created_at timestamptz, expires_at timestamptz, saved_at timestamptz, ended boolean,
  ended_by text, agents integer, tasks integer
)
language sql stable security definer set search_path = public as $$
  select b.id, b.space_id, b.project_id, b.guest_id, b.edit_hash = p_hash, p.name,
         b.created_at, b.expires_at, b.saved_at,
         (b.ended_at is not null or b.expires_at < now()),
         coalesce(b.ended_by, case when b.expires_at < now() then 'expired' end),
         (select count(*)::int from scratch_agent a where a.workspace_id = b.space_id),
         (select count(*)::int from task t where t.project_id = b.project_id and t.deleted_at is null)
  from scratch_board b
  join project p on p.id = b.project_id
  where (b.edit_hash = p_hash or b.view_hash = p_hash) and b.space_id is not null
$$;
revoke all on function board_find(text) from public;
grant execute on function board_find(text) to tracker_app;

/*
 * The actor an agent's name stands for on a board, made the first time the
 * name is used — up to `p_most` names. Only by the edit secret, and only on
 * a board still open.
 */
create function board_agent(p_hash text, p_name text, p_most int)
returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare
  b scratch_board%rowtype;
  found_id uuid;
  made uuid;
begin
  select * into b from scratch_board
  where edit_hash = p_hash and space_id is not null and ended_at is null
    and expires_at >= now() and saved_at is null
  for update;
  if not found then return null; end if;
  select a.actor_id into found_id from scratch_agent a
  where a.workspace_id = b.space_id and lower(a.name) = lower(p_name);
  if found then return found_id; end if;
  if (select count(*) from scratch_agent a where a.workspace_id = b.space_id) >= p_most then
    return null;
  end if;
  made := gen_random_uuid();
  insert into actor (id, name) values (made, p_name);
  insert into membership (id, workspace_id, actor_id, role, joined_at)
  values (gen_random_uuid(), b.space_id, made, 'member', now());
  insert into project_member (id, workspace_id, project_id, actor_id, added_by, rights)
  values (gen_random_uuid(), b.space_id, b.project_id, made, b.guest_id, '{task.create}');
  insert into scratch_agent (workspace_id, actor_id, name) values (b.space_id, made, p_name);
  update scratch_board set first_agent_at = coalesce(first_agent_at, now()) where id = b.id;
  return made;
end $$;
revoke all on function board_agent(text, text, int) from public;
grant execute on function board_agent(text, text, int) to tracker_app;

/* A change moves the date: thirty days on from now, never past the
   ceiling. Reading does not. */
create function board_touched(p_hash text, p_days int, p_made int)
returns void
language sql volatile security definer set search_path = public as $$
  update scratch_board
  set last_write_at = now(),
      expires_at = least(now() + make_interval(days => p_days), ends_by),
      tasks_made = tasks_made + greatest(p_made, 0)
  where edit_hash = p_hash and space_id is not null and ended_at is null and saved_at is null
$$;
revoke all on function board_touched(text, int, int) from public;
grant execute on function board_touched(text, int, int) to tracker_app;

/* An agent connected: said when the board's MCP server is first asked
   anything, whether or not a name was given. */
create function board_agent_seen(p_hash text)
returns void
language sql volatile security definer set search_path = public as $$
  update scratch_board set first_agent_at = now()
  where edit_hash = p_hash and first_agent_at is null and space_id is not null
$$;
revoke all on function board_agent_seen(text) from public;
grant execute on function board_agent_seen(text) to tracker_app;

/* -------------------------------------------------------------- saving */

/*
 * What a board holds, for the person saving it: its lists by position, its
 * tasks and their comments, with the names of who wrote them. By the edit
 * secret, once, and only while the board is kept.
 */
create function board_contents(p_hash text)
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
$$;
revoke all on function board_contents(text) from public;
grant execute on function board_contents(text) to tracker_app;

/*
 * Taken once: the save that marks it is the save that happens. Asked
 * inside the transaction that writes the project, so a save that fails
 * leaves the board as it was. The board is read-only from here and goes
 * seven days later.
 */
create function board_save_take(p_hash text, p_project uuid, p_workspace uuid, p_keep_days int)
returns boolean
language plpgsql volatile security definer set search_path = public as $$
begin
  update scratch_board
  set saved_at = now(), saved_project_id = p_project, saved_workspace_id = p_workspace,
      expires_at = least(expires_at, now() + make_interval(days => p_keep_days))
  where edit_hash = p_hash and space_id is not null and saved_at is null;
  return found;
end $$;
revoke all on function board_save_take(text, uuid, uuid, int) from public;
grant execute on function board_save_take(text, uuid, uuid, int) to tracker_app;

/* ------------------------------------------------------------- reports */

create function board_report(p_hash text, p_reason text, p_contact text)
returns boolean
language plpgsql volatile security definer set search_path = public as $$
declare
  b uuid;
begin
  select id into b from scratch_board
  where (edit_hash = p_hash or view_hash = p_hash) and space_id is not null;
  if not found then return false; end if;
  /* Twenty open reports on one board is enough to act on; more is noise. */
  if (select count(*) from scratch_report where board_id = b and handled_at is null) >= 20 then
    return true;
  end if;
  insert into scratch_report (id, board_id, reason, contact)
  values (gen_random_uuid(), b, left(p_reason, 2000), nullif(left(coalesce(p_contact, ''), 200), ''));
  return true;
end $$;
revoke all on function board_report(text, text, text) from public;
grant execute on function board_report(text, text, text) to tracker_app;

/* -------------------------------------------------------------- worker */

/*
 * Boards whose day has come: ended, and their workspace marked deleted —
 * which `auth_context` and every policy already read as gone. The page
 * says "This board has expired" and still offers Save for the days the
 * board is kept; `boards_purge` takes it after.
 */
create function boards_expire()
returns integer
language plpgsql volatile security definer set search_path = public as $$
declare
  n integer;
begin
  with due as (
    update scratch_board set ended_at = now(), ended_by = 'expired'
    where ended_at is null and expires_at < now() and space_id is not null
    returning space_id
  )
  update workspace w set deleted_at = coalesce(w.deleted_at, now())
  from due where w.id = due.space_id;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function boards_expire() from public;
grant execute on function boards_expire() to tracker_worker;

/*
 * And boards ended more than `p_days` ago, cleared: the workspace with
 * everything in it, then the actors that were only ever the board's — the
 * guest and the agents' names. Fifty a pass, each on its own, so one that
 * cannot go does not hold the rest.
 */
create function boards_purge(p_days int)
returns integer
language plpgsql volatile security definer set search_path = public as $$
declare
  b record;
  who uuid[];
  n integer := 0;
begin
  for b in
    select id, space_id, guest_id from scratch_board
    where space_id is not null and ended_at is not null
      and ended_at < now() - make_interval(days => p_days)
    order by ended_at
    limit 50
  loop
    begin
      select array_agg(actor_id) || b.guest_id into who
      from scratch_agent where workspace_id = b.space_id;
      who := coalesce(who, array[b.guest_id]);
      perform purge_workspace(b.space_id);
      delete from actor where id = any(who);
      n := n + 1;
    exception when others then
      raise warning 'boards_purge: board % could not go: %', b.id, sqlerrm;
    end;
  end loop;
  return n;
end $$;
revoke all on function boards_purge(int) from public;
grant execute on function boards_purge(int) to tracker_worker;

/* ------------------------------------------------------------ operators */

create function operator_boards()
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
    'saved_plans', coalesce((
      select json_object_agg(plan, n) from (
        select w.plan, count(*) as n from scratch_board b join workspace w on w.id = b.saved_workspace_id
        where b.saved_at is not null group by w.plan) x), '{}'),
    'sources', coalesce((
      select json_object_agg(s, n) from (
        select coalesce(source, '') as s, count(*) as n from scratch_board
        where created_at > now() - interval '30 days' group by 1) x), '{}'),
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
revoke all on function operator_boards() from public;
grant execute on function operator_boards() to tracker_app;

/* An operator ends a board at once: its workspace marked deleted, its
   reports handled. The clear-out takes it as it takes an expired one. */
create function operator_end_board(p_board uuid)
returns boolean
language plpgsql volatile security definer set search_path = public as $$
declare
  ws uuid;
begin
  if not is_operator() then return false; end if;
  update scratch_board set ended_at = coalesce(ended_at, now()), ended_by = coalesce(ended_by, 'operator'),
                           expires_at = least(expires_at, now())
  where id = p_board and space_id is not null
  returning space_id into ws;
  if not found then return false; end if;
  update workspace set deleted_at = coalesce(deleted_at, now()) where id = ws;
  update scratch_report set handled_at = now() where board_id = p_board and handled_at is null;
  return true;
end $$;
revoke all on function operator_end_board(uuid) from public;
grant execute on function operator_end_board(uuid) to tracker_app;

create function operator_report_done(p_report uuid)
returns boolean
language plpgsql volatile security definer set search_path = public as $$
begin
  if not is_operator() then return false; end if;
  update scratch_report set handled_at = now() where id = p_report and handled_at is null;
  return found;
end $$;
revoke all on function operator_report_done(uuid) from public;
grant execute on function operator_report_done(uuid) to tracker_app;

/*
 * The operators' list of workspaces, without the boards: a board is a
 * workspace underneath and a line in the boards' panel above, never a
 * company. The function as migration 096 last wrote it, and one line.
 */
create or replace function operator_workspaces(p_q text, p_before_at timestamptz, p_before_id uuid, p_limit integer, p_only uuid default null)
returns table(id uuid, name text, slug text, plan text, created_at timestamptz, mark_icon text, mark_tint smallint, icon_key text, owner_id uuid, owner_name text, owner_email text, people integer, projects integer, bytes bigint, gift_until timestamptz, gifted boolean)
language sql stable security definer set search_path = public as $$
  select w.id, w.name, w.slug::text, w.plan, w.created_at,
         w.mark_icon, w.mark_tint, w.icon_key,
         o.actor_id, a.name, u.email::text,
         workspace_people(w.id),
         (select count(*)::int from project p where p.workspace_id = w.id and p.deleted_at is null),
         workspace_storage_bytes(w.id),
         g.until, g.workspace_id is not null
  from workspace w
  left join lateral (
    select m.actor_id from membership m
    where m.workspace_id = w.id and m.role = 'owner' and m.deleted_at is null
    order by m.created_at limit 1
  ) o on true
  left join actor a on a.id = o.actor_id
  left join app_user u on u.actor_id = o.actor_id
  left join plan_gift g on g.workspace_id = w.id
  where is_operator() and w.deleted_at is null and not w.scratch
    and (p_only is null or w.id = p_only)
    and (p_q is null
         or w.name ilike '%' || p_q || '%' or w.slug::text ilike '%' || p_q || '%'
         or a.name ilike '%' || p_q || '%' or u.email::text ilike '%' || p_q || '%')
    and (p_before_at is null or (w.created_at, w.id) < (p_before_at, p_before_id))
  order by w.created_at desc, w.id desc
  limit least(greatest(p_limit, 1), 100)
$$;

/*
 * The landing's address, refused as a workspace's — `/agent-board`. The
 * list as migration 144 left it, and one word. Before this goes live we confirm no workspace in production already has it: the check
 * constraint is `not valid`, so a workspace that has it keeps it and the
 * landing would answer where its owner expects their company.
 */
create or replace function workspace_slug_allowed(p_slug text) returns boolean
language sql immutable set search_path = public as $$
  select p_slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'
     and p_slug not in (
       'api', 'auth', 'mcp', 'health', 'assets', 'static', 'files', 'cdn',
       'invite', 'join', 'welcome', 'signup', 'signin', 'sign-in', 'sign-up',
       'login', 'logout', 'forgot', 'reset', 'oauth', 'admin', 'settings',
       'notifications', 'members', 'chat', 'search', 'projects', 'new',
       'help', 'about', 'pricing', 'blog', 'docs', 'status', 'www', 'app',
       'tuff', 'usetuff', 'sw', 'manifest', 'favicon', 'robots', 'sitemap',
       'privacy', 'terms', 'legal', 'verify',
       'compare', 'for', 'refunds', 'alternatives',
       'agent-board')
$$;
