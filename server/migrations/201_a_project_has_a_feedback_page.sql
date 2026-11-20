/*
 * A feedback page, phase 1: asking.
 *
 * A project's public page, where anybody asks for something without an
 * account. What they ask waits until they confirm their address, and is
 * then filed as a task in the project's Triage by the page's own actor —
 * through the task route, like anything else that makes a task.
 *
 * No fifth entity: a request is a task. What is here sits beside tasks,
 * the way `github_issue` does — the page (configuration of a project),
 * the people who asked (the page's mailing list, not people of the
 * workspace), what waits for a confirmation, and which task came from
 * which request.
 *
 * Every table carries `workspace_id`, so `purge_workspace` takes it with
 * the rest. And each goes with its project, and a request with its task,
 * by cascade, as `github_issue` does (158): `purge_project_rows` and the
 * clear-out know none of these tables, and without it a project with a
 * page could never be deleted for good, its requesters' addresses kept
 * for ever. The public routes reach these rows only through the definer
 * functions below, each keyed on one page; the team's reach them under the
 * workspace's own policies.
 */

/* ------------------------------------------------------------- the page */

create table feedback_page (
  id           uuid primary key,
  workspace_id uuid not null references workspace(id),
  project_id   uuid not null unique references project(id) on delete cascade,
  /* Who files what the page is asked — an actor without an account, a
     member of the workspace and of the project, as an agent is. */
  actor_id     uuid not null unique references actor(id),
  /* Global, because `/f/` has nothing in front of it: the workspace
     address's rule and its reserved words. */
  slug         text not null unique check (workspace_slug_allowed(slug)),
  name         text not null check (char_length(name) between 1 and 80),
  intro        text check (char_length(intro) <= 200),
  live         boolean not null default false,
  created_by   uuid not null references actor(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table feedback_page enable row level security;
create policy fp_in_project on feedback_page for select to tracker_app
  using (workspace_id in (select staff_workspaces())
         and (current_workspace() is null or workspace_id = current_workspace())
         and project_id in (select visible_projects()));
/* Changed only by whoever runs the project — what `feedback.manage` is in
   `can` — so a member on it who reaches the row cannot rename the page or
   turn it on, whatever a route forgets to ask. */
create policy fp_run on feedback_page for update to tracker_app
  using ((current_workspace() is null or workspace_id = current_workspace())
         and manages_project(project_id))
  with check ((current_workspace() is null or workspace_id = current_workspace())
              and manages_project(project_id));
/* Made only by `feedback_page_make`, which makes its actor with it. */
grant select on feedback_page to tracker_app;
grant update (slug, name, intro, live, updated_at) on feedback_page to tracker_app;

/*
 * A slug given up keeps pointing at its page for thirty days, and nobody
 * else may take it in that time: a link printed in a newsletter does not
 * land on somebody else's page a week later.
 */
create table feedback_old_slug (
  slug         text primary key,
  workspace_id uuid not null references workspace(id),
  page_id      uuid not null references feedback_page(id) on delete cascade,
  until        timestamptz not null
);
alter table feedback_old_slug enable row level security;

/*
 * One namespace for live slugs and held ones, and one writer at a time for
 * each name: a lock per slug, taken for the new name and the one given up,
 * in a fixed order, so two pages renaming at once wait for each other and
 * the second sees what the first did. Each statement below reads afresh
 * (the function is volatile), so the check after the lock sees a rename
 * committed while it waited.
 *
 * A page holds one old slug at most, and keeps the promise it made with
 * it: thirty days of pointing here. So a page that holds one is not
 * renamed again until the hold runs out — except back to the held name,
 * which is taking it back. Letting the earlier name go instead would
 * break the link printed with it, and renaming in a loop would sit on a
 * list of names.
 */
create function feedback_slug_held() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  names text[];
  n text;
begin
  names := array[new.slug];
  if tg_op = 'UPDATE' and old.slug <> new.slug then names := names || old.slug; end if;
  foreach n in array (select array_agg(x order by x) from unnest(names) x) loop
    perform pg_advisory_xact_lock(hashtext('feedback_slug:' || n));
  end loop;
  if exists (select 1 from feedback_old_slug o
             where o.slug = new.slug and o.page_id <> new.id and o.until > now())
     or exists (select 1 from feedback_page f where f.slug = new.slug and f.id <> new.id) then
    raise exception 'feedback_slug_taken' using errcode = '23505';
  end if;
  if tg_op = 'UPDATE' and old.slug <> new.slug then
    if exists (select 1 from feedback_old_slug o
               where o.page_id = new.id and o.slug <> new.slug and o.until > now()) then
      raise exception 'feedback_slug_holding' using errcode = 'P0001';
    end if;
    delete from feedback_old_slug where page_id = new.id;
    insert into feedback_old_slug (slug, workspace_id, page_id, until)
    values (old.slug, old.workspace_id, old.id, now() + interval '30 days')
    on conflict (slug) do update set page_id = excluded.page_id, until = excluded.until;
  end if;
  return new;
end $$;
create trigger feedback_slug_held before insert or update of slug on feedback_page
  for each row execute function feedback_slug_held();

/* Whether a slug is free for this page — asked before saving, so the field
   can say so; the unique index and the trigger are what make it true. */
create function feedback_slug_free(p_slug text, p_page uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select workspace_slug_allowed(p_slug)
     and not exists (select 1 from feedback_page where slug = p_slug and id is distinct from p_page)
     and not exists (select 1 from feedback_old_slug
                     where slug = p_slug and page_id is distinct from p_page and until > now())
$$;
revoke all on function feedback_slug_free(text, uuid) from public;
grant execute on function feedback_slug_free(text, uuid) to tracker_app;

/*
 * The page, made with its actor. Asked of the person making it, inside:
 * the project has to be one they can see in the workspace they are in —
 * the route has already asked `can`, and this is the row's own answer.
 */
create function feedback_page_make(
  p_page uuid, p_project uuid, p_slug text, p_name text, p_actor_name text
) returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare
  ws uuid;
  who uuid := current_actor();
  a uuid := gen_random_uuid();
begin
  select p.workspace_id into ws from project p
  where p.id = p_project and p.deleted_at is null
    and p.id in (select visible_projects())
    and p.workspace_id = current_workspace();
  if ws is null or who is null then
    raise exception 'feedback_page_make: no such project' using errcode = '42501';
  end if;
  insert into actor (id, name) values (a, left(p_actor_name, 60));
  insert into membership (id, workspace_id, actor_id, role, joined_at)
  values (gen_random_uuid(), ws, a, 'member', now());
  insert into project_member (id, workspace_id, project_id, actor_id, added_by, rights)
  values (gen_random_uuid(), ws, p_project, a, who, '{task.create}');
  insert into feedback_page (id, workspace_id, project_id, actor_id, slug, name, created_by)
  values (p_page, ws, p_project, a, p_slug, p_name, who);
  return p_page;
end $$;
revoke all on function feedback_page_make(uuid, uuid, text, text, text) from public;
grant execute on function feedback_page_make(uuid, uuid, text, text, text) to tracker_app;

/* Whether an actor is a feedback page's — for the places that count and
   list people, which leave it out as they leave agents out. */
create function page_actor(p_actor uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from feedback_page where actor_id = p_actor)
$$;
revoke all on function page_actor(uuid) from public;
grant execute on function page_actor(uuid) to tracker_app, tracker_worker;

/* A page's actor takes no seat: the plan's ceiling counts people. */
create or replace function workspace_people(ws uuid) returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::integer from membership m
  where m.workspace_id = ws and m.deleted_at is null
    and not exists (select 1 from agent g where g.actor_id = m.actor_id)
    and not exists (select 1 from feedback_page f where f.actor_id = m.actor_id)
$$;

/* A page gone — its project deleted for good — takes its actor out of the
   workspace: left in, it would stand in Members and take a seat, a page's
   actor no longer known as one. */
create function feedback_page_gone() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update membership set deleted_at = now()
  where actor_id = old.actor_id and workspace_id = old.workspace_id and deleted_at is null;
  update project_member set deleted_at = now()
  where actor_id = old.actor_id and deleted_at is null;
  return old;
end $$;
create trigger feedback_page_gone after delete on feedback_page
  for each row execute function feedback_page_gone();

/* ------------------------------------------------------- who follows it */

create table feedback_follower (
  workspace_id uuid not null references workspace(id),
  project_id   uuid not null references project(id) on delete cascade,
  page_id      uuid not null references feedback_page(id) on delete cascade,
  actor_id     uuid not null references actor(id),
  created_at   timestamptz not null default now(),
  primary key (page_id, actor_id)
);
alter table feedback_follower enable row level security;
/* Anybody on the project sees who follows; each follows for themselves. */
create policy ff_read on feedback_follower for select to tracker_app
  using ((current_workspace() is null or workspace_id = current_workspace())
         and project_id in (select visible_projects()));
create policy ff_own on feedback_follower for insert to tracker_app
  with check (actor_id = current_actor()
              and (current_workspace() is null or workspace_id = current_workspace())
              and project_id in (select visible_projects()));
create policy ff_own_off on feedback_follower for delete to tracker_app
  using (actor_id = current_actor());
grant select, insert, delete on feedback_follower to tracker_app;

/* ----------------------------------------------------- who asked, and what */

/*
 * Somebody who asked, one row per address per page: the page's mailing
 * list. No account, no membership. `key_hash` is the hash of the key their
 * browser was handed when they confirmed, which spares them a link the
 * next time.
 */
create table feedback_person (
  id              uuid primary key,
  workspace_id    uuid not null references workspace(id),
  project_id      uuid not null references project(id) on delete cascade,
  page_id         uuid not null references feedback_page(id) on delete cascade,
  email           citext not null check (char_length(email) <= 254),
  language        text not null default 'en' check (language in ('en', 'fr')),
  confirmed_at    timestamptz,
  key_hash        text unique,
  blocked_at      timestamptz,
  unsubscribed_at timestamptz,
  created_at      timestamptz not null default now(),
  unique (page_id, email)
);
alter table feedback_person enable row level security;
create policy fpe_in_project on feedback_person for select to tracker_app
  using ((current_workspace() is null or workspace_id = current_workspace())
         and project_id in (select visible_projects()));
grant select on feedback_person to tracker_app;

/*
 * A request waiting for its address to be confirmed. Nothing in it is a
 * task yet, and the application cannot read it: only the hash of the
 * mailed link opens it, through `feedback_confirm`.
 */
create table feedback_pending (
  id           uuid primary key,
  workspace_id uuid not null references workspace(id),
  page_id      uuid not null references feedback_page(id) on delete cascade,
  person_id    uuid not null references feedback_person(id) on delete cascade,
  title        text not null check (char_length(title) between 1 and 120),
  body         text not null default '' check (char_length(body) <= 4000),
  token_hash   text unique,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  /* Taken by a press, so two presses file one task. */
  claimed_at   timestamptz
);
create index feedback_pending_due on feedback_pending (expires_at);
create index feedback_pending_page on feedback_pending (page_id, created_at);
alter table feedback_pending enable row level security;

/* Which task came from which request, with the requester's own words as
   they sent them — the team may rename the task; the requester's title is
   what any later mail to them says. */
create table feedback_item (
  task_id      uuid primary key references task(id) on delete cascade,
  workspace_id uuid not null references workspace(id),
  project_id   uuid not null references project(id) on delete cascade,
  page_id      uuid not null references feedback_page(id) on delete cascade,
  person_id    uuid references feedback_person(id) on delete set null,
  asked_title  text not null,
  asked_body   text not null default '',
  created_at   timestamptz not null default now()
);
create index feedback_item_page on feedback_item (page_id, created_at);
alter table feedback_item enable row level security;
create policy fi_in_project on feedback_item for select to tracker_app
  using ((current_workspace() is null or workspace_id = current_workspace())
         and project_id in (select visible_projects()));
grant select on feedback_item to tracker_app;

/* ---------------------------------------------------- the public's doors */

/*
 * The page a slug names, for a reader with no session. `available` is
 * false when it is off, its project archived, or its workspace on Duo or
 * gone — the page then says it isn't available, with no word about why.
 * A slug given up in the last thirty days answers with `moved_to`.
 */
create function feedback_page_by_slug(p_slug text)
returns table (
  page_id uuid, workspace_id uuid, project_id uuid, actor_id uuid, slug text, name text,
  intro text, mark_icon text, mark_tint int, icon_key text, available boolean, moved_to text
)
language sql stable security definer set search_path = public as $$
  select f.id, f.workspace_id, f.project_id, f.actor_id, f.slug, f.name, f.intro,
         p.mark_icon, p.mark_tint, p.icon_key,
         (f.live and p.deleted_at is null and p.archived_at is null
          and w.deleted_at is null and w.plan <> 'solo' and not w.scratch),
         case when f.slug <> p_slug then f.slug end
  from feedback_page f
  join project p on p.id = f.project_id
  join workspace w on w.id = f.workspace_id
  where f.slug = p_slug
     or f.id = (select o.page_id from feedback_old_slug o where o.slug = p_slug and o.until > now())
  limit 1
$$;
revoke all on function feedback_page_by_slug(text) from public;
grant execute on function feedback_page_by_slug(text) to tracker_app;

/* What a page took today: requests filed, and those claimed and on their way. */
create function feedback_filed_today(p_page uuid) returns int
language sql stable security definer set search_path = public as $$
  select ((select count(*) from feedback_item
           where page_id = p_page and person_id is not null and created_at > now() - interval '1 day')
        + (select count(*) from feedback_pending
           where page_id = p_page and claimed_at is not null and created_at > now() - interval '1 day'))::int
$$;
revoke all on function feedback_filed_today(uuid) from public;

/*
 * A request held until its address is confirmed — or, for a browser that
 * already confirmed (`p_key_hash`), held and claimed at once, so the route
 * files it without a mail. Answers who asked and whether they may be
 * listened to; a blocked address is held nowhere and answers `blocked`.
 * The page's daily ceiling is counted here, under the page's row lock, so
 * requests arriving together cannot pass it between them.
 */
create function feedback_hold(
  p_page uuid, p_email text, p_key_hash text, p_language text,
  p_title text, p_body text, p_token_hash text, p_hours int, p_most_a_day int, p_most_waiting int
) returns table (pending_id uuid, person_id uuid, email text, confirmed boolean, blocked boolean, full_today boolean)
language plpgsql volatile security definer set search_path = public as $$
#variable_conflict use_column
declare
  pg feedback_page;
  who feedback_person;
  held uuid := gen_random_uuid();
  today int;
begin
  select * into pg from feedback_page where id = p_page for update;
  if pg.id is null then return; end if;
  if p_key_hash is not null then
    select * into who from feedback_person
    where page_id = p_page and key_hash = p_key_hash and confirmed_at is not null;
    if who.id is null then return; end if;
  else
    insert into feedback_person (id, workspace_id, project_id, page_id, email, language)
    values (gen_random_uuid(), pg.workspace_id, pg.project_id, p_page, lower(p_email), coalesce(p_language, 'en'))
    on conflict (page_id, email) do update set language = coalesce(p_language, feedback_person.language)
    returning * into who;
  end if;
  if who.blocked_at is not null then
    return query select null::uuid, who.id, who.email::text, false, true, false;
    return;
  end if;
  /*
   * Two ceilings, so unconfirmed spam cannot close a page for the day: a
   * key files at once and counts against what the page took today; a link
   * waits, and counts against what is waiting. Neither touches the other.
   */
  if p_key_hash is not null then
    today := feedback_filed_today(p_page);
  else
    select count(*) into today from feedback_pending
    where page_id = p_page and claimed_at is null and token_hash is not null
      and created_at > now() - interval '1 day';
  end if;
  if today >= (case when p_key_hash is not null then p_most_a_day else p_most_waiting end) then
    return query select null::uuid, who.id, who.email::text, who.confirmed_at is not null, false, true;
    return;
  end if;
  insert into feedback_pending (id, workspace_id, page_id, person_id, title, body, token_hash, expires_at, claimed_at)
  values (held, pg.workspace_id, p_page, who.id, p_title, coalesce(p_body, ''),
          case when p_key_hash is null then p_token_hash end,
          now() + make_interval(hours => p_hours),
          case when p_key_hash is not null then now() end);
  return query select held, who.id, who.email::text, who.confirmed_at is not null, false, false;
end $$;
revoke all on function feedback_hold(uuid, text, text, text, text, text, text, int, int, int) from public;
grant execute on function feedback_hold(uuid, text, text, text, text, text, text, int, int, int) to tracker_app;

/* What a mailed link would confirm — read, never acted on, so the page
   opened by a mail scanner changes nothing. */
create function feedback_waiting(p_page uuid, p_token_hash text)
returns table (title text, body text, email text, expired boolean, done boolean)
language sql stable security definer set search_path = public as $$
  select h.title, h.body, pe.email::text, h.expires_at < now(), h.claimed_at is not null
  from feedback_pending h join feedback_person pe on pe.id = h.person_id
  where h.page_id = p_page and h.token_hash = p_token_hash
$$;
revoke all on function feedback_waiting(uuid, text) from public;
grant execute on function feedback_waiting(uuid, text) to tracker_app;

/*
 * The press on a mailed link: the address is confirmed, the browser's key
 * written, and the request claimed — once. A second press, or a press
 * after the link ran out, claims nothing. A claim left for five minutes
 * (the filing failed) may be taken again.
 */
create function feedback_confirm(p_page uuid, p_token_hash text, p_key_hash text, p_most_a_day int)
returns table (pending_id uuid, person_id uuid, title text, body text, language text, full_today boolean)
language plpgsql volatile security definer set search_path = public as $$
#variable_conflict use_column
declare
  h feedback_pending;
begin
  /* Under the page's lock, as a hold is: the day's ceiling of filed
     requests is asked of a confirmation too, which would otherwise be the
     way past it. The link is left as it was, to be pressed tomorrow. */
  perform 1 from feedback_page where id = p_page for update;
  if feedback_filed_today(p_page) >= p_most_a_day then
    return query select null::uuid, null::uuid, null::text, null::text, null::text, true;
    return;
  end if;
  update feedback_pending set claimed_at = now()
  where page_id = p_page and token_hash = p_token_hash and expires_at > now()
    and (claimed_at is null or claimed_at < now() - interval '5 minutes')
  returning * into h;
  if h.id is null then return; end if;
  update feedback_person
  set confirmed_at = coalesce(confirmed_at, now()), key_hash = p_key_hash
  where id = h.person_id and blocked_at is null;
  if not found then
    delete from feedback_pending where id = h.id;
    return;
  end if;
  return query select h.id, h.person_id, h.title, h.body, pe.language, false
    from feedback_person pe where pe.id = h.person_id;
end $$;
revoke all on function feedback_confirm(uuid, text, text, int) from public;
grant execute on function feedback_confirm(uuid, text, text, int) to tracker_app;

/* The task a claimed request became: written down, and the hold gone. */
create function feedback_filed(p_pending uuid, p_task uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  h feedback_pending;
  pg feedback_page;
begin
  delete from feedback_pending where id = p_pending and claimed_at is not null returning * into h;
  if h.id is null then return; end if;
  select * into pg from feedback_page where id = h.page_id;
  insert into feedback_item (task_id, workspace_id, project_id, page_id, person_id, asked_title, asked_body)
  select p_task, pg.workspace_id, pg.project_id, pg.id, h.person_id, h.title, h.body
  from task t where t.id = p_task and t.project_id = pg.project_id;
end $$;
revoke all on function feedback_filed(uuid, uuid) from public;
grant execute on function feedback_filed(uuid, uuid) to tracker_app;

/* A claim the filing could not finish, let go so the link works again. */
create function feedback_unclaim(p_pending uuid) returns void
language sql volatile security definer set search_path = public as $$
  update feedback_pending set claimed_at = null where id = p_pending and token_hash is not null;
  delete from feedback_pending where id = p_pending and token_hash is null;
$$;
revoke all on function feedback_unclaim(uuid) from public;
grant execute on function feedback_unclaim(uuid) to tracker_app;

/* A claimed hold whose task was made but could not be written down: gone,
   so the link cannot file it a second time. */
create function feedback_drop(p_pending uuid) returns void
language sql volatile security definer set search_path = public as $$
  delete from feedback_pending where id = p_pending and claimed_at is not null;
$$;
revoke all on function feedback_drop(uuid) from public;
grant execute on function feedback_drop(uuid) to tracker_app;

/* The project a page's actor files into — the only one `can` lets it. */
create function feedback_actor_project(p_actor uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select project_id from feedback_page where actor_id = p_actor
$$;
revoke all on function feedback_actor_project(uuid) from public;
grant execute on function feedback_actor_project(uuid) to tracker_app;

/* Who a browser's key says it is, on this page — the address it shows as
   "Sending as …". Nothing for a key this page never handed out. */
create function feedback_known(p_page uuid, p_key_hash text) returns table (email text)
language sql stable security definer set search_path = public as $$
  select email::text from feedback_person
  where page_id = p_page and key_hash = p_key_hash and confirmed_at is not null and blocked_at is null
$$;
revoke all on function feedback_known(uuid, text) from public;
grant execute on function feedback_known(uuid, text) to tracker_app;

/* Who hears of a new request: the page's followers still on its project. */
create function feedback_followers(p_page uuid) returns table (actor_id uuid)
language sql stable security definer set search_path = public as $$
  select ff.actor_id from feedback_follower ff
  join feedback_page f on f.id = ff.page_id
  join membership m on m.actor_id = ff.actor_id and m.workspace_id = f.workspace_id and m.deleted_at is null
  where ff.page_id = p_page
    and (m.role = 'owner' or exists (
      select 1 from project_member pm
      where pm.project_id = f.project_id and pm.actor_id = ff.actor_id and pm.deleted_at is null))
$$;
revoke all on function feedback_followers(uuid) from public;
grant execute on function feedback_followers(uuid) to tracker_app;

/* The clear-out: holds nobody confirmed, two days on. */
create function feedback_pending_sweep() returns integer
language sql volatile security definer set search_path = public as $$
  with gone as (delete from feedback_pending where expires_at < now() - interval '1 day' returning 1)
  select count(*)::int from gone
$$;
revoke all on function feedback_pending_sweep() from public;
grant execute on function feedback_pending_sweep() to tracker_worker;
