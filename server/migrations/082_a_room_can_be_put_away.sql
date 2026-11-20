-- A room put away, and one that came back — `docs/specs/sidebar-hide.md`.
--
-- `hidden_at`: the person moved it under "More chats" at the foot of the
-- list. `surfaced_at`: something was said in it since, so it came back out
-- and stands at the head of the list until they arrange it themselves.
-- Both on the person's own row in the room, like the read mark and `notify`.
alter table conversation_member add column hidden_at timestamptz;
alter table conversation_member add column surfaced_at timestamptz;
