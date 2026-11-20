/*
 * Slack.
 *
 * The owner connects one Slack workspace to this one; a project names one
 * of its channels; what happens in the project worth telling is queued in
 * the same transaction as the feed's line, and the worker posts it.
 *
 * The bot token is the whole Slack workspace's, so the column is not
 * granted to the application role. A request reads it only through
 * `slack_token()`, for the session's own workspace, to list its channels;
 * the worker through its claim, which the application cannot call.
 */

create table slack_connection (
  id uuid primary key,
  workspace_id uuid not null references workspace(id),
  team_id text not null,
  team_name text not null,
  token_enc text not null,
  connected_by uuid not null references actor(id),
  created_at timestamptz not null default now(),
  /* Slack said the token is no good: nothing is tried until it is connected again. */
  broken_at timestamptz,
  broken text,
  deleted_at timestamptz
);
create unique index slack_connection_per_workspace on slack_connection (workspace_id) where deleted_at is null;
/* One Tuff workspace a Slack workspace: a bot token is the app's in that
   Slack, and two workspaces holding it would revoke it for each other. */
create unique index slack_connection_once on slack_connection (team_id) where deleted_at is null;
alter table slack_connection enable row level security;
create policy sc_in_workspace on slack_connection for all to tracker_app
  using (workspace_id = current_workspace())
  with check (workspace_id = current_workspace());
grant select (id, workspace_id, team_id, team_name, connected_by, created_at, broken_at, broken, deleted_at)
  on slack_connection to tracker_app;

create table slack_link (
  id uuid primary key,
  workspace_id uuid not null references workspace(id),
  project_id uuid not null references project(id) on delete cascade,
  connection_id uuid not null references slack_connection(id),
  channel_id text not null check (channel_id ~ '^[CG][A-Z0-9]{2,30}$'),
  channel_name text not null,
  private boolean not null,
  linked_by uuid not null references actor(id),
  created_at timestamptz not null default now(),
  /* Slack said the channel is gone, archived, or the app was taken out of it. */
  stopped_at timestamptz,
  stopped text,
  deleted_at timestamptz
);
create unique index slack_link_per_project on slack_link (project_id) where deleted_at is null;
alter table slack_link enable row level security;
create policy sl_in_project on slack_link for all to tracker_app
  using (workspace_id = current_workspace() and project_id in (select visible_projects()))
  /* And its connection this workspace's: one slip in a handler would
     otherwise post one company's news with another's token. */
  with check (workspace_id = current_workspace() and project_id in (select visible_projects())
              and exists (select 1 from slack_connection sc
                          where sc.id = connection_id and sc.workspace_id = slack_link.workspace_id));
grant select, insert, update (deleted_at) on slack_link to tracker_app;

/* The way to Slack and back, spent once: a state that leaked — a log, a
   screenshot, a consent screen left open — finishes nothing for whoever
   holds it once its owner has come back, or after ten minutes. */
create table slack_state (
  nonce text primary key,
  workspace_id uuid not null references workspace(id),
  actor_id uuid not null references actor(id),
  until timestamptz not null default now() + interval '10 minutes'
);
alter table slack_state enable row level security;

create function slack_state_make(p_nonce text) returns void
language sql volatile security definer set search_path = public as $$
  delete from slack_state where until < now();
  insert into slack_state (nonce, workspace_id, actor_id)
  select p_nonce, current_workspace(), current_actor()
  where current_workspace() is not null and current_actor() is not null
$$;
revoke execute on function slack_state_make(text) from public;
grant execute on function slack_state_make(text) to tracker_app;

create function slack_state_take(p_nonce text) returns boolean
language sql volatile security definer set search_path = public as $$
  with spent as (
    delete from slack_state
    where nonce = p_nonce and workspace_id = current_workspace() and actor_id = current_actor() and until > now()
    returning 1
  )
  select exists (select 1 from spent)
$$;
revoke execute on function slack_state_take(text) from public;
grant execute on function slack_state_take(text) to tracker_app;

/* What is owed to Slack: ids only, and the words read when it is sent. */
create table slack_out (
  id uuid primary key,
  workspace_id uuid not null references workspace(id),
  project_id uuid not null references project(id) on delete cascade,
  link_id uuid not null references slack_link(id) on delete cascade,
  kind text not null check (kind in ('created', 'finished', 'commented', 'announced')),
  object_id uuid not null,
  comment_id uuid,
  /* The list a task went into, as it was: read when sent, a task moved on
     in the meantime was "created in Done". */
  list_name text,
  actor_id uuid not null references actor(id),
  created_at timestamptz not null default now(),
  next_at timestamptz not null default now(),
  claimed_at timestamptz,
  tries int not null default 0,
  done_at timestamptz,
  error text
);
create index slack_out_waiting on slack_out (link_id, created_at) where done_at is null;
create index slack_out_by_age on slack_out (created_at);
alter table slack_out enable row level security;

/*
 * Queued from `record`, beside the feed's line and in its transaction. Of
 * the session's own workspace only, and only for a project whose channel
 * is live on a connection that is: a channel the app was taken out of is
 * not owed a backlog. What is news is decided here, from the rows as this
 * transaction left them:
 *
 * - `task.create` — a task, not a part of one;
 * - `task.update` — a task finished in this transaction, by a done list or
 *   by its box: `completed_at` is this transaction's `now()`;
 * - `task.comment` — the comment this person made on it just now;
 * - `post.create` — an announcement published as it was made.
 */
create function slack_queue(p_action text, p_project uuid, p_object uuid, p_actor uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  l uuid;
  k text;
  c uuid;
  ln text;
begin
  if current_workspace() is null or p_project is null or p_object is null then
    return 0;
  end if;
  select sl.id into l
  from slack_link sl join slack_connection sc on sc.id = sl.connection_id and sc.workspace_id = sl.workspace_id
  where sl.project_id = p_project and sl.workspace_id = current_workspace()
    and sl.deleted_at is null and sl.stopped_at is null
    and sc.deleted_at is null and sc.broken_at is null;
  if l is null then
    return 0;
  end if;
  /* A channel that has two hundred waiting is not told the two hundred and
     first: a script making tasks all day is not a queue for everybody. */
  if (select count(*) from slack_out where link_id = l and done_at is null) >= 200 then
    return 0;
  end if;

  if p_action = 'task.create' then
    select tl.name into ln from task t left join task_list tl on tl.id = t.list_id
    where t.id = p_object and t.project_id = p_project and t.parent_id is null and t.deleted_at is null
      /* Made now: a task restored from the bin is recorded as made, and was
         news once already. */
      and t.created_at = now();
    if not found then
      return 0;
    end if;
    k := 'created';
  elsif p_action = 'task.update' then
    if not exists (select 1 from task where id = p_object and project_id = p_project and parent_id is null
                   and deleted_at is null and completed_at = now()) then
      return 0;
    end if;
    /* Once for a finishing, though the handler records twice in it. */
    if exists (select 1 from slack_out where object_id = p_object and kind = 'finished' and created_at = now()) then
      return 0;
    end if;
    k := 'finished';
  elsif p_action = 'task.comment' then
    select id into c from comment
    where object_id = p_object and project_id = p_project and author_id = p_actor
      and created_at = now() and deleted_at is null
    order by id desc limit 1;
    if c is null then
      return 0;
    end if;
    k := 'commented';
  elsif p_action = 'post.create' then
    if not exists (select 1 from post where id = p_object and project_id = p_project
                   and published_at is not null and deleted_at is null) then
      return 0;
    end if;
    k := 'announced';
  else
    return 0;
  end if;

  insert into slack_out (id, workspace_id, project_id, link_id, kind, object_id, comment_id, list_name, actor_id)
  values (gen_random_uuid(), current_workspace(), p_project, l, k, p_object, c, ln, p_actor);
  return 1;
end $$;
revoke execute on function slack_queue(text, uuid, uuid, uuid) from public;
grant execute on function slack_queue(text, uuid, uuid, uuid) to tracker_app;

/*
 * The worker's: the oldest waiting message of each channel, at most one a
 * channel a pass — Slack takes about one a second in a channel — with the
 * token to send it and the words, read now. A row claimed and never
 * finished is taken again after five minutes; ten tries and it is given up.
 */
create function slack_out_claim(p_n int) returns table (
  id uuid, tries int, token_enc text, connection_id uuid, link_id uuid, channel_id text,
  kind text, actor_name text, project_key text, project_slug text, workspace_slug text,
  number int, title text, list_name text, list_icon text, said text, gone boolean
)
language sql volatile security definer set search_path = public as $$
  with heads as (
    /* The first waiting message of each channel — in order in a channel,
       nothing overtakes what came before it. */
    select o.id, o.workspace_id, o.created_at
    from slack_out o
    join slack_link sl on sl.id = o.link_id and sl.deleted_at is null and sl.stopped_at is null
    join slack_connection sc on sc.id = sl.connection_id and sc.workspace_id = sl.workspace_id
      and sc.deleted_at is null and sc.broken_at is null
    where o.done_at is null and o.next_at <= now()
      and (o.claimed_at is null or o.claimed_at < now() - interval '5 minutes')
      and not exists (
        select 1 from slack_out b
        where b.link_id = o.link_id and b.done_at is null and b.created_at < o.created_at)
  ), picked as (
    /* The longest waiting first, and five a workspace a pass: one company
       with many busy channels does not hold everybody else's back. */
    select id from (
      select id, created_at, row_number() over (partition by workspace_id order by created_at) as nth
      from heads
    ) h
    where nth <= 5
    order by created_at
    limit p_n
  ), claimed as (
    update slack_out o set claimed_at = now(), tries = o.tries + 1
    from picked where o.id = picked.id
      /* Asked again once the row is ours: a second pass at the same moment
         finds it claimed and leaves it. */
      and (o.claimed_at is null or o.claimed_at < now() - interval '5 minutes')
    returning o.*
  )
  select o.id, o.tries, sc.token_enc, sc.id, sl.id, sl.channel_id,
         o.kind, a.name, p.key, p.slug::text, w.slug::text,
         coalesce(t.number, po.number),
         coalesce(t.title, po.title),
         o.list_name, tl.icon,
         left(case o.kind
           when 'commented' then words_of(cm.body)
           when 'announced' then words_of(po.body)
           else null end, 2000),
         (case when o.kind = 'announced' then po.id is null else t.id is null end)
           or (o.kind = 'commented' and cm.id is null)
           or p.deleted_at is not null
  from claimed o
  join slack_link sl on sl.id = o.link_id
  join slack_connection sc on sc.id = sl.connection_id and sc.workspace_id = sl.workspace_id
  join project p on p.id = o.project_id
  join workspace w on w.id = o.workspace_id
  join actor a on a.id = o.actor_id
  /* In the project it was queued for: a task moved to another since would
     be linked under the wrong project's address. */
  left join task t on o.kind <> 'announced' and t.id = o.object_id and t.project_id = o.project_id and t.deleted_at is null
  left join task_list tl on tl.id = t.list_id
  left join post po on o.kind = 'announced' and po.id = o.object_id and po.project_id = o.project_id and po.deleted_at is null
  left join comment cm on cm.id = o.comment_id and cm.deleted_at is null
$$;
revoke execute on function slack_out_claim(int) from public, tracker_app;
grant execute on function slack_out_claim(int) to tracker_worker;

/* Sent, given up, or to be tried again after `p_wait`. Slack saying "too
   many" is not this message failing, so its try is given back. */
create function slack_out_done(p_id uuid, p_error text, p_wait interval) returns void
language sql volatile security definer set search_path = public as $$
  update slack_out
  set done_at = case when p_wait is null then now() else null end,
      tries = case when p_error = 'ratelimited' then greatest(tries - 1, 0) else tries end,
      claimed_at = null,
      next_at = case when p_wait is null then next_at else now() + p_wait end,
      error = p_error
  where id = p_id
$$;
revoke execute on function slack_out_done(uuid, text, interval) from public, tracker_app;
grant execute on function slack_out_done(uuid, text, interval) to tracker_worker;

/* Slack said the token is no good, or the channel is: stopped, with why. */
create function slack_broken(p_connection uuid, p_link uuid, p_why text) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if p_link is not null then
    update slack_link set stopped_at = now(), stopped = p_why where id = p_link and stopped_at is null;
  else
    update slack_connection set broken_at = now(), broken = p_why where id = p_connection and broken_at is null;
  end if;
end $$;
revoke execute on function slack_broken(uuid, uuid, text) from public, tracker_app;
grant execute on function slack_broken(uuid, uuid, text) to tracker_worker;

/* Thirty days after it was queued, sent or not: a message a month late is
   not news, and a channel stopped since is not owed it. */
create function slack_clear() returns int
language plpgsql volatile security definer set search_path = public as $$
declare n int;
begin
  delete from slack_out where created_at < now() - interval '30 days';
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function slack_clear() from public, tracker_app;
grant execute on function slack_clear() to tracker_worker;

/* The token, for the request that lists channels and the one that
   disconnects — of the session's own workspace and nobody else's. */
create function slack_token() returns table (connection_id uuid, token_enc text)
language sql stable security definer set search_path = public as $$
  select id, token_enc from slack_connection
  where workspace_id = current_workspace() and deleted_at is null
$$;
revoke execute on function slack_token() from public;
grant execute on function slack_token() to tracker_app;

/*
 * Connected, by the owner, to the Slack workspace `oauth.v2.access` named.
 * Refused when that Slack workspace is another Tuff workspace's — asked
 * here, where every workspace's rows can be seen. Connecting again to the
 * same Slack, after a token went bad, keeps the projects' channels.
 */
create function slack_connect(p_team text, p_name text, p_token_enc text, p_actor uuid)
returns table (said text, old_token text)
language plpgsql volatile security definer set search_path = public as $$
declare
  old uuid;
  old_team text;
  old_enc text;
  made uuid := gen_random_uuid();
begin
  /* The owner's, here as well as in the handler. */
  if current_workspace() is null or p_actor is distinct from current_actor()
     or role_in(current_workspace()) is distinct from 'owner' then
    return query select 'forbidden'::text, null::text;
    return;
  end if;
  if exists (select 1 from slack_connection
             where team_id = p_team and deleted_at is null and workspace_id <> current_workspace()) then
    return query select 'taken'::text, null::text;
    return;
  end if;
  select id, team_id, token_enc into old, old_team, old_enc from slack_connection
  where workspace_id = current_workspace() and deleted_at is null;
  update slack_connection set deleted_at = now(), token_enc = '' where id = old;
  insert into slack_connection (id, workspace_id, team_id, team_name, token_enc, connected_by)
  values (made, current_workspace(), p_team, left(p_name, 200), p_token_enc, p_actor);
  if old is not null and old_team = p_team then
    update slack_link set connection_id = made where connection_id = old and deleted_at is null;
    /* What waited while it was broken goes now, not at its next try. */
    update slack_out set next_at = now()
    where done_at is null and link_id in (select id from slack_link where connection_id = made);
  else
    update slack_link set deleted_at = now() where connection_id = old and deleted_at is null;
  end if;
  /* Another Slack's token, to be revoked there: the same Slack's is the
     one just given again. */
  return query select 'ok'::text, case when old_team is distinct from p_team then nullif(old_enc, '') end;
end $$;
revoke execute on function slack_connect(text, text, text, uuid) from public;
grant execute on function slack_connect(text, text, text, uuid) to tracker_app;

/* Disconnected: every project's channel with it, and the token gone from
   the row in the same statement. Answers the token, once, to be revoked
   at Slack. */
create function slack_disconnect() returns text
language plpgsql volatile security definer set search_path = public as $$
declare
  c uuid;
  t text;
begin
  if current_workspace() is null or role_in(current_workspace()) is distinct from 'owner' then
    return null;
  end if;
  select id, token_enc into c, t from slack_connection
  where workspace_id = current_workspace() and deleted_at is null;
  if c is null then
    return null;
  end if;
  update slack_link set deleted_at = now() where connection_id = c and deleted_at is null;
  update slack_connection set deleted_at = now(), token_enc = '' where id = c;
  return t;
end $$;
revoke execute on function slack_disconnect() from public;
grant execute on function slack_disconnect() to tracker_app;
