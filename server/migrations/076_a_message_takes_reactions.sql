-- An emoji on a message — `docs/specs/chat-threads.md`.
--
-- A property of the message, not a fifth entity: nothing is filed under a
-- reaction, and it lives and dies with the message it is on. One row per
-- person per emoji, so pressing it twice is a question the index answers.
-- The workspace is on the row, as on every row: a policy that had to reach
-- through the message to find out whose row it is could not be bounded
-- cheaply.
create table message_reaction (
  id uuid primary key,
  workspace_id uuid not null references workspace(id),
  -- Going with the message when the clear-out finally deletes it: this
  -- table has no `deleted_at` of its own, so `purge_deleted` would never
  -- reach these rows and would stall on them instead.
  message_id uuid not null references message(id) on delete cascade,
  actor_id uuid not null references actor(id),
  emoji text not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now()
);
create unique index message_reaction_once on message_reaction (message_id, actor_id, emoji);

alter table message_reaction enable row level security;

-- Visible exactly when the message is: a reaction says somebody read it, and
-- that is not for anyone who could not read the message.
create policy mr_read on message_reaction for select to tracker_app
  using (
    (current_workspace() is null or workspace_id = current_workspace())
    and exists (select 1 from message m
                where m.id = message_reaction.message_id
                  and m.conversation_id in (select visible_conversations()))
  );
-- Your own, on a message you can read.
create policy mr_write on message_reaction for insert to tracker_app
  with check (
    actor_id = current_actor()
    and (current_workspace() is null or workspace_id = current_workspace())
    and exists (select 1 from message m
                where m.id = message_reaction.message_id
                  and m.conversation_id in (select visible_conversations()))
  );
-- And only your own taken back.
create policy mr_delete on message_reaction for delete to tracker_app
  using (actor_id = current_actor());

grant select, insert, delete on message_reaction to tracker_app;
