-- What a message says, as plain text, so a room can be searched.
--
-- The body is the editor's document — paragraphs of text nodes with marks
-- between them — and `ilike` on it would match the JSON as well as the
-- words. The words are drawn out by the database itself, so nothing that
-- writes a message has to remember to write this, and kept under a trigram
-- index: the load table has a channel with a million messages, and
-- an unanchored pattern with no index is a read of every one of them.
-- `docs/specs/find.md`.
create function words_of(body jsonb) returns text
  language sql immutable parallel safe
  as $$
    select coalesce(string_agg(t #>> '{}', ' '), '')
    from jsonb_path_query(body, 'strict $.** ? (@.type == "text").text') t
  $$;

alter table message add column said text
  generated always as (words_of(body)) stored;

create index message_said_trgm on message using gin (said gin_trgm_ops)
  where deleted_at is null;
