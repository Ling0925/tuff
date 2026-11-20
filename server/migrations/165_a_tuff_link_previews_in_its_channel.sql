/*
 * Previews of Tuff links in Slack.
 *
 * Slack says a message has a usetuff.com address in it; the request
 * handler, which has no session, can only queue it, and only for a channel
 * some project posts to. The worker reads the address and asks
 * `slack_preview`, which answers only when the address's project is the
 * one that posts to that channel on that connection.
 */

/* What the connection was granted, so settings can say a connection made
   before previews needs connecting again; and who Tuff is in that Slack,
   so a message Tuff posted is not previewed. */
alter table slack_connection add column scopes text not null default '';
alter table slack_connection add column bot_user text;
grant select (scopes) on slack_connection to tracker_app;

drop function slack_connect(text, text, text, uuid);
create function slack_connect(p_team text, p_name text, p_token_enc text, p_actor uuid, p_scopes text, p_bot text)
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
  insert into slack_connection (id, workspace_id, team_id, team_name, token_enc, connected_by, scopes, bot_user)
  values (made, current_workspace(), p_team, left(p_name, 200), p_token_enc, p_actor, left(p_scopes, 500),
          case when p_bot ~ '^[UW][A-Z0-9]{2,30}$' then p_bot end);
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
revoke execute on function slack_connect(text, text, text, uuid, text, text) from public;
grant execute on function slack_connect(text, text, text, uuid, text, text) to tracker_app;

/* A message whose addresses are owed a preview: ids and addresses only. */
create table slack_unfurl (
  id uuid primary key,
  /* Gone with its connection: a workspace deleted takes its connection
     with it, and a queued preview must not stand in the way. */
  connection_id uuid not null references slack_connection(id) on delete cascade,
  channel_id text not null,
  message_ts text not null,
  urls text[] not null,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  done_at timestamptz,
  error text
);
/* Once a message: Slack sends an event again when it thinks we missed it,
   and again with the same message when a link is added by editing it. */
create unique index slack_unfurl_once on slack_unfurl (connection_id, channel_id, message_ts);
create index slack_unfurl_waiting on slack_unfurl (created_at) where claimed_at is null;
alter table slack_unfurl enable row level security;

/*
 * From the request Slack signed, with no session: kept only for a channel
 * a project posts to on a live connection of that Slack, and not for a
 * message Tuff posted. Five addresses at most, each cut at 2 000.
 */
create function slack_unfurl_put(p_team text, p_channel text, p_ts text, p_user text, p_urls text[]) returns int
language plpgsql volatile security definer set search_path = public as $$
declare
  c uuid;
  bot text;
  n int;
begin
  if p_team !~ '^T[A-Z0-9]{2,30}$' or p_channel !~ '^[CG][A-Z0-9]{2,30}$'
     or p_ts !~ '^[0-9]{1,12}\.[0-9]{1,8}$' or coalesce(cardinality(p_urls), 0) = 0 then
    return 0;
  end if;
  select sc.id, sc.bot_user into c, bot from slack_connection sc
  where sc.team_id = p_team and sc.deleted_at is null and sc.broken_at is null
    and exists (select 1 from slack_link sl
                where sl.connection_id = sc.id and sl.workspace_id = sc.workspace_id
                  and sl.channel_id = p_channel and sl.deleted_at is null and sl.stopped_at is null);
  if c is null or (bot is not null and p_user is not distinct from bot) then
    return 0;
  end if;
  /* A Slack pasting addresses faster than they are answered is not owed a
     backlog. Counted over the five minutes a row can still be answered in:
     what a worker that was down left behind is never claimed, and must not
     shut previews off until it is cleared. */
  if (select count(*) from slack_unfurl
      where connection_id = c and claimed_at is null and created_at > now() - interval '5 minutes') >= 200 then
    return 0;
  end if;
  insert into slack_unfurl (id, connection_id, channel_id, message_ts, urls)
  values (gen_random_uuid(), c, p_channel, p_ts,
          array(select left(u, 2000) from unnest(p_urls) with ordinality as x(u, i) where u is not null order by i limit 5))
  /* The same message with other addresses — edited to add one — is
     answered again; the same addresses again are not. */
  on conflict (connection_id, channel_id, message_ts) do update
    set urls = excluded.urls, created_at = now(), claimed_at = null, done_at = null, error = null
    where slack_unfurl.urls is distinct from excluded.urls;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function slack_unfurl_put(text, text, text, text, text[]) from public;
grant execute on function slack_unfurl_put(text, text, text, text, text[]) to tracker_app;

/* The worker's: what waits, with the token to answer it. Five minutes
   late, a preview is not worth sending. */
create function slack_unfurl_claim(p_n int) returns table (id uuid, token_enc text, channel_id text, message_ts text, urls text[])
language sql volatile security definer set search_path = public as $$
  with picked as (
    select u.id from slack_unfurl u
    where u.claimed_at is null and u.created_at > now() - interval '5 minutes'
    order by u.created_at
    limit p_n
    for update skip locked
  ), claimed as (
    update slack_unfurl u set claimed_at = now() from picked where u.id = picked.id returning u.*
  )
  select c.id, sc.token_enc, c.channel_id, c.message_ts, c.urls
  from claimed c
  join slack_connection sc on sc.id = c.connection_id and sc.deleted_at is null and sc.broken_at is null
$$;
revoke execute on function slack_unfurl_claim(int) from public, tracker_app;
grant execute on function slack_unfurl_claim(int) to tracker_worker;

create function slack_unfurl_done(p_id uuid, p_error text) returns void
language sql volatile security definer set search_path = public as $$
  update slack_unfurl set done_at = now(), error = p_error where id = p_id
$$;
revoke execute on function slack_unfurl_done(uuid, text) from public, tracker_app;
grant execute on function slack_unfurl_done(uuid, text) to tracker_worker;

/*
 * What one address shows, asked for one waiting message. Only when the
 * address's workspace is the connection's and its project is one whose
 * channel this is, on that connection: a link pasted in one company's
 * channel never reads another's project, nor another project of the same
 * company. Nothing in the bin, no draft, no part of a task, and no file
 * of a chat room, whose members are not always the project's.
 */
create function slack_preview(p_unfurl uuid, p_ws text, p_project text, p_kind text, p_number int)
returns table (
  kind text, workspace_slug text, project_slug text, project_name text, project_key text,
  number int, title text, list_name text, list_icon text, done boolean, people text, due_on date,
  at timestamptz, said text, file_kind text, content_type text, size_bytes bigint, address text
)
language sql stable security definer set search_path = public as $$
  with here as (
    select p.id, p.name, p.key, p.slug::text as pslug, w.slug::text as wslug, p.description
    from slack_unfurl u
    join slack_connection sc on sc.id = u.connection_id and sc.deleted_at is null and sc.broken_at is null
    join slack_link sl on sl.connection_id = sc.id and sl.workspace_id = sc.workspace_id
      and sl.channel_id = u.channel_id and sl.deleted_at is null and sl.stopped_at is null
    join project p on p.id = sl.project_id and p.workspace_id = sc.workspace_id and p.deleted_at is null
    join workspace w on w.id = sc.workspace_id and w.deleted_at is null
    where u.id = p_unfurl
      and lower(w.slug::text) = lower(p_ws) and lower(p.slug::text) = lower(p_project)
  )
  select 'project', h.wslug, h.pslug, h.name, h.key, null::int, h.name, null, null, false, null, null::date,
         null::timestamptz, h.description, null, null, null::bigint, null
  from here h where p_kind = 'project'
  union all
  select 'task', h.wslug, h.pslug, h.name, h.key, t.number, t.title, tl.name, tl.icon, t.completed_at is not null,
         (select string_agg(a.name, ', ' order by a.name) from actor a where a.id = any(t.assignee_ids) or a.id = t.assignee_id),
         t.due_on, null, t.said, null, null, null, null
  from here h
  join task t on t.project_id = h.id and t.number = p_number and t.parent_id is null and t.deleted_at is null
  left join task_list tl on tl.id = t.list_id and tl.deleted_at is null
  where p_kind = 'task'
  union all
  select 'post', h.wslug, h.pslug, h.name, h.key, po.number, po.title, null, null, false, a.name, null,
         po.published_at, po.said, null, null, null, null
  from here h
  join post po on po.project_id = h.id and po.number = p_number and po.deleted_at is null
    and po.published_at is not null and po.published_at <= now()
  join actor a on a.id = po.author_id
  where p_kind = 'post'
  union all
  select 'file', h.wslug, h.pslug, h.name, h.key, f.number, f.name, null, null, false, a.name, null,
         coalesce(f.updated_at, f.created_at), f.said,
         case when f.url is not null then 'link' when f.storage_key is not null then 'upload' else 'doc' end,
         f.content_type, f.size_bytes,
         /* A link's host and no more: the whole address is often the
            access itself — a document shared with whoever has it. */
         substring(f.url from '^[a-zA-Z][a-zA-Z0-9+.-]*://([^/?#:@]+)')
  from here h
  join file f on f.project_id = h.id and f.number = p_number and f.deleted_at is null and f.conversation_id is null
    and (f.storage_key is null or f.uploaded_at is not null)
    /* A folder is a place, not a thing to read. */
    and (f.body is not null or f.url is not null or f.storage_key is not null)
  join actor a on a.id = f.author_id
  where p_kind = 'file'
$$;
revoke execute on function slack_preview(uuid, text, text, text, int) from public, tracker_app;
grant execute on function slack_preview(uuid, text, text, text, int) to tracker_worker;

/* And the previews' rows go after a day, answered or not. */
create or replace function slack_clear() returns int
language plpgsql volatile security definer set search_path = public as $$
declare n int; m int;
begin
  delete from slack_out where created_at < now() - interval '30 days';
  get diagnostics n = row_count;
  delete from slack_unfurl where created_at < now() - interval '1 day';
  get diagnostics m = row_count;
  return n + m;
end $$;
revoke execute on function slack_clear() from public, tracker_app;
grant execute on function slack_clear() to tracker_worker;
