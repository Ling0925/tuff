-- The whole schema, written first.
--
-- Four things a person creates — post, task, file, message — and a set of
-- service records nobody makes by hand. Everything else in the product is a
-- field on one of these or a view of them.
--
-- Every table carries workspace_id, including the ones where it looks
-- redundant. The design requires each query to be bounded by workspace *in the
-- query* rather than in a controller, and that is only possible if the column
-- is always there to bound on.

create extension if not exists citext;
create extension if not exists pgcrypto;

create type role_kind as enum ('owner', 'admin', 'member', 'client');
create type tool_kind as enum ('posts', 'tasks', 'files', 'messages');
create type origin_kind as enum ('web', 'macos', 'ios', 'android', 'mcp', 'system');
create type object_kind as enum ('post', 'task', 'file', 'message', 'conversation', 'project');
create type notify_reason as enum ('mentioned', 'assigned', 'subscribed');

-- ------------------------------------------------------------------ people
create table actor (
  id uuid primary key,
  name text not null,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table app_user (
  actor_id uuid primary key references actor(id),
  email citext not null unique,
  email_verified_at timestamptz,
  password_hash text not null,
  totp_secret_enc text,
  totp_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table workspace (
  id uuid primary key,
  name text not null,
  slug citext not null unique,
  settings jsonb not null default
    '{"who_creates_projects":"members","who_invites_clients":"admins","edit_others_content":"documents_too"}',
  plan text not null default 'flat',
  limits jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table membership (
  id uuid primary key,
  workspace_id uuid not null references workspace(id),
  actor_id uuid not null references actor(id),
  role role_kind not null,
  invited_by uuid references actor(id),
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index membership_unique on membership (workspace_id, actor_id)
  where deleted_at is null;

-- ---------------------------------------------------------------- projects
create table project (
  id uuid primary key,
  workspace_id uuid not null references workspace(id),
  name text not null,
  description text,
  tools tool_kind[] not null default '{posts,tasks,files,messages}',
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index project_by_workspace on project (workspace_id) where deleted_at is null;

create table project_member (
  id uuid primary key,
  workspace_id uuid not null references workspace(id),
  project_id uuid not null references project(id),
  actor_id uuid not null references actor(id),
  added_by uuid references actor(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index project_member_unique on project_member (project_id, actor_id)
  where deleted_at is null;
create index project_member_by_actor on project_member (actor_id) where deleted_at is null;

-- ------------------------------------------------------- the four entities
create table post (
  id uuid primary key,
  workspace_id uuid not null references workspace(id),
  project_id uuid not null references project(id),
  author_id uuid not null references actor(id),
  visible_to_client boolean not null default false,
  title text not null,
  body jsonb not null default '{}',
  category text,
  published_at timestamptz,
  schedule text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index post_by_project on post (project_id, created_at desc) where deleted_at is null;

create table task_list (
  id uuid primary key,
  workspace_id uuid not null references workspace(id),
  project_id uuid not null references project(id),
  author_id uuid not null references actor(id),
  visible_to_client boolean not null default false,
  name text not null,
  sort_key text not null,
  progress double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table task (
  id uuid primary key,
  workspace_id uuid not null references workspace(id),
  project_id uuid not null references project(id),
  author_id uuid not null references actor(id),
  visible_to_client boolean not null default false,
  list_id uuid references task_list(id),
  "group" text,
  title text not null,
  body jsonb,
  assignee_ids uuid[] not null default '{}',
  due_on date,
  starts_at timestamptz,
  ends_at timestamptz,
  column_name text,
  sort_key text not null,
  completed_at timestamptz,
  -- The board shows age since the last decision, not since creation: a card
  -- nobody has touched is the one worth seeing.
  decided_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index task_by_project on task (project_id, sort_key) where deleted_at is null;
create index task_by_due on task (workspace_id, due_on) where deleted_at is null;
create index task_by_assignee on task using gin (assignee_ids);

create table task_step (
  id uuid primary key,
  workspace_id uuid not null references workspace(id),
  task_id uuid not null references task(id),
  title text not null,
  done_at timestamptz,
  sort_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table file (
  id uuid primary key,
  workspace_id uuid not null references workspace(id),
  project_id uuid not null references project(id),
  author_id uuid not null references actor(id),
  visible_to_client boolean not null default false,
  folder_id uuid references file(id),
  name text not null,
  body jsonb,
  storage_key text,
  content_type text,
  size_bytes bigint,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table conversation (
  id uuid primary key,
  workspace_id uuid not null references workspace(id),
  project_id uuid references project(id),
  name text,
  visible_to_client boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table conversation_member (
  id uuid primary key,
  workspace_id uuid not null references workspace(id),
  conversation_id uuid not null references conversation(id),
  actor_id uuid not null references actor(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index conversation_member_unique
  on conversation_member (conversation_id, actor_id) where deleted_at is null;

create table message (
  id uuid primary key,
  workspace_id uuid not null references workspace(id),
  conversation_id uuid not null references conversation(id),
  author_id uuid not null references actor(id),
  parent_id uuid references message(id),
  body jsonb not null,
  origin origin_kind not null default 'web',
  edited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
-- A million messages in a channel is in the load table, so the index
-- that pages them is here from the first migration rather than the first
-- complaint.
create index message_by_conversation on message (conversation_id, created_at desc, id)
  where deleted_at is null;

-- -------------------------------------------------------- service records
create table comment (
  id uuid primary key,
  workspace_id uuid not null references workspace(id),
  project_id uuid references project(id),
  object_type object_kind not null,
  object_id uuid not null,
  author_id uuid not null references actor(id),
  body jsonb not null,
  origin origin_kind not null default 'web',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index comment_on_object on comment (object_type, object_id, created_at)
  where deleted_at is null;

create table subscription (
  id uuid primary key,
  workspace_id uuid not null references workspace(id),
  object_type object_kind not null,
  object_id uuid not null,
  actor_id uuid not null references actor(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index subscription_unique
  on subscription (object_type, object_id, actor_id) where deleted_at is null;

create table time_entry (
  id uuid primary key,
  workspace_id uuid not null references workspace(id),
  project_id uuid not null references project(id),
  object_type object_kind,
  object_id uuid,
  actor_id uuid not null references actor(id),
  minutes int not null check (minutes > 0),
  spent_on date not null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table object_link (
  id uuid primary key,
  workspace_id uuid not null references workspace(id),
  from_type object_kind not null,
  from_id uuid not null,
  to_type object_kind not null,
  to_id uuid not null,
  created_by uuid not null references actor(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Immutable, and it names the author of every action including the ones that
-- arrived through a tool. A client is never served this.
create table activity_event (
  id uuid primary key,
  workspace_id uuid not null references workspace(id),
  project_id uuid references project(id),
  actor_id uuid not null references actor(id),
  action text not null,
  object_type object_kind,
  object_id uuid,
  origin origin_kind not null default 'web',
  at timestamptz not null default now(),
  meta jsonb not null default '{}'
);
create index activity_by_workspace on activity_event (workspace_id, at desc);

create table notification (
  id uuid primary key,
  workspace_id uuid not null references workspace(id),
  actor_id uuid not null references actor(id),
  reason notify_reason not null,
  object_type object_kind not null,
  object_id uuid not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index notification_unread on notification (actor_id, created_at desc)
  where read_at is null and deleted_at is null;

-- ----------------------------------------------------------- credentials
create table invite (
  id uuid primary key,
  workspace_id uuid not null references workspace(id),
  email citext,
  role role_kind not null,
  project_ids uuid[] not null default '{}',
  token_hash text not null unique,
  created_by uuid not null references actor(id),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references actor(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table api_token (
  id uuid primary key,
  workspace_id uuid not null references workspace(id),
  actor_id uuid not null references actor(id),
  name text not null,
  project_ids uuid[] not null default '{}',
  token_hash text not null unique,
  last_used_at timestamptz,
  last_used_ip text,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table refresh_session (
  id uuid primary key,
  actor_id uuid not null references actor(id),
  token_hash text not null unique,
  user_agent text,
  ip text,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

create table security_event (
  id uuid primary key,
  workspace_id uuid references workspace(id),
  actor_id uuid references actor(id),
  kind text not null,
  ip text,
  user_agent text,
  at timestamptz not null default now(),
  meta jsonb not null default '{}'
);

-- --------------------------------------------------------------- updated_at
create function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'actor', 'app_user', 'workspace', 'membership', 'project', 'project_member',
    'post', 'task_list', 'task', 'task_step', 'file', 'conversation',
    'conversation_member', 'message', 'comment', 'subscription', 'time_entry',
    'object_link', 'notification', 'invite', 'api_token'
  ]
  loop
    execute format('create trigger touch before update on %I
      for each row execute function touch_updated_at()', t);
  end loop;
end $$;
