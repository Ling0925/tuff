/*
 * A workspace is made with its plan, its address and its mark.
 *
 * It was a name and nothing else, the address and the plan the server's.
 * We asked for the three to be chosen where the workspace is made:
 * the address is what goes on every link anybody sends, and the mark is what
 * tells two workspaces apart in the switcher at sixteen pixels.
 */

-- The mark, as a project's is: a glyph and a tint, or a picture instead.
-- All null is the letter it has always had.
alter table workspace
  add column mark_icon text,
  add column mark_tint smallint,
  add column icon_key text,
  add constraint workspace_mark_tint_range check (mark_tint is null or mark_tint between 0 and 9),
  add constraint workspace_mark_icon_short check (mark_icon is null or length(mark_icon) between 1 and 20);

/*
 * Whether an address can be a workspace's: its shape, and not one of the
 * words the app's own pages stand at. A workspace called "welcome" was given
 * `/welcome`, which is the landing page's — the first link anybody sent to
 * it would have opened the landing.
 */
create function workspace_slug_allowed(p_slug text) returns boolean
language sql immutable set search_path = public as $$
  select p_slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'
     and p_slug not in (
       'api', 'auth', 'mcp', 'health', 'assets', 'static', 'files', 'cdn',
       'invite', 'join', 'welcome', 'signup', 'signin', 'sign-in', 'sign-up',
       'login', 'logout', 'forgot', 'reset', 'oauth', 'admin', 'settings',
       'notifications', 'members', 'chat', 'search', 'projects', 'new',
       'help', 'about', 'pricing', 'blog', 'docs', 'status', 'www', 'app',
       'tuff', 'usetuff', 'sw', 'manifest', 'favicon', 'robots', 'sitemap')
$$;

/* Free: allowed, and nobody has it — deleted workspaces included, since a
   purged one's links may still be out there. A definer, because the rows it
   looks past are other companies'. */
create function workspace_slug_free(p_slug text) returns boolean
language sql stable security definer set search_path = public as $$
  select workspace_slug_allowed(p_slug)
     and not exists (select 1 from workspace where slug = p_slug::citext)
$$;
grant execute on function workspace_slug_free(text) to tracker_app;

-- The next free address now steps past the app's own words too.
create or replace function free_workspace_slug(p_name text) returns citext
language plpgsql stable security definer set search_path = public as $$
declare
  raw text := trim(both '-' from left(coalesce(slugify(p_name), 'workspace'), 36));
  base text := case when length(raw) < 3 then raw || '-team' else raw end;
  candidate citext := base;
  n int := 1;
begin
  while not workspace_slug_free(candidate) loop
    n := n + 1;
    candidate := base || '-' || n;
  end loop;
  return candidate;
end $$;

/*
 * Made with what was chosen. An address given is taken as it is or refused
 * — `slug_taken`, `slug_invalid` — rather than quietly bent into the next
 * free one: somebody who typed an address and was told it was free expects
 * that one, and a race lost is something to say, not to paper over. None
 * given is the next free one from the name, as before.
 */
create or replace function new_workspace(
  p_actor uuid, p_workspace uuid, p_name text,
  p_slug text, p_plan text, p_icon text, p_tint smallint)
returns citext
language plpgsql security definer set search_path = public as $$
declare
  candidate citext;
begin
  if not exists (select 1 from actor where id = p_actor and deleted_at is null) then
    raise exception 'no such actor';
  end if;
  if p_slug is null then
    candidate := free_workspace_slug(p_name);
  else
    if not workspace_slug_allowed(lower(p_slug)) then
      raise exception 'slug_invalid' using errcode = 'P0001';
    end if;
    if exists (select 1 from workspace where slug = p_slug::citext) then
      raise exception 'slug_taken' using errcode = 'P0001';
    end if;
    candidate := lower(p_slug);
  end if;

  insert into workspace (id, name, slug, plan, mark_icon, mark_tint)
    values (p_workspace, p_name, candidate, coalesce(p_plan, 'solo'), p_icon, p_tint);
  insert into membership (id, workspace_id, actor_id, role, joined_at)
    values (gen_random_uuid(), p_workspace, p_actor, 'owner', now());
  insert into security_event (id, workspace_id, actor_id, kind)
    values (gen_random_uuid(), p_workspace, p_actor, 'workspace_created');
  perform starting_labels(p_workspace);
  return candidate;
end $$;
grant execute on function new_workspace(uuid, uuid, text, text, text, text, smallint) to tracker_app;
