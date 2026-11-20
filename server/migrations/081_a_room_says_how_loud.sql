-- How loud a room is for one person.
--
-- Slack's three: every new message, only when you are named, or nothing.
-- On the person's own row in the room, which a project's channel gets the
-- first time it is read (`mark_read`) or set — with no `joined_at`, so it is
-- a place to keep a mark and a setting, not a way in.
alter table conversation_member add column notify text not null default 'all'
  check (notify in ('all', 'mentions', 'none'));
