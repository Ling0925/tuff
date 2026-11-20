/*
 * Messages in search.
 *
 * As the other three `search_*` functions: run as their owner so an index
 * can be used — `ilike` is not leakproof — and saying in the query what the
 * policies say: this workspace, and only the rooms this person may read.
 *
 * In two steps, because the two kinds of question want opposite plans. A
 * word said rarely is found fastest through the words' index; a word said
 * everywhere ("meeting", "today") matched every one of a million messages
 * there, and sorting them all for the newest twenty took seven seconds.
 * So the newest twenty thousand of the workspace's messages are read first,
 * newest first, through an index on when they were said: a common word
 * fills its twenty there. Only when it does not is anything older looked
 * for.
 *
 * Older, by its words rather than its letters. The trigram index read every
 * entry of every trigram in the question, so "Message 424242" in a room of
 * a million messages that all say "Message" cost two hundred milliseconds
 * for one answer; a word index skips the common word and is led by the
 * rare one — twenty. Each word typed is a word or the start of one, and
 * what comes back still holds the whole phrase as typed. Two thousand
 * candidates at most, so a word said everywhere older than the window
 * cannot sort a million: past that the order is the index's, not time's.
 */

create index message_newest_in on message (workspace_id, created_at desc) where deleted_at is null;
create index message_words on message using gin (to_tsvector('simple', said)) where deleted_at is null;

create function search_messages(p_q text, p_project uuid)
returns table (id uuid, conversation_id uuid, parent_id uuid, author_name text, created_at timestamptz, snippet text)
language plpgsql stable security definer set search_path = public as $$
declare
  pattern text := '%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  edge timestamptz;
  found int;
  words text;
begin
  if current_workspace() is null or length(p_q) < 3 then
    return;
  end if;
  /* Where the newest twenty thousand end; null when that is all of them. */
  select m.created_at into edge from message m
  where m.workspace_id = current_workspace() and m.deleted_at is null
  order by m.created_at desc offset 19999 limit 1;

  return query execute $q$
    select m.id, m.conversation_id, m.parent_id, coalesce(m.said_as, a.name), m.created_at,
           substr(m.said, greatest(1, strpos(lower(m.said), lower($3)) - 32), 96)
    from (select * from message r
          where r.workspace_id = current_workspace() and r.deleted_at is null
            and ($4::timestamptz is null or r.created_at >= $4)
          order by r.created_at desc limit 20000) m
    join actor a on a.id = m.author_id
    join conversation cv on cv.id = m.conversation_id
    where m.said ilike $1
      and m.conversation_id in (select visible_conversations())
      and ($2::uuid is null or cv.project_id = $2)
    order by m.created_at desc
    limit 20
  $q$
  using pattern, p_project, p_q, edge;
  get diagnostics found = row_count;
  if found >= 20 or edge is null then
    return;
  end if;

  /* Older than the window, by its words: each a word or the start of one. */
  select string_agg(quote_literal(w) || ':*', ' & ') into words
  from regexp_split_to_table(lower(p_q), '[^[:alnum:]]+') w where w <> '';
  if words is null then
    return;
  end if;
  return query execute $q$
    with hit as materialized (
      select h.id from message h
      where to_tsvector('simple', h.said) @@ to_tsquery('simple', $6) and h.deleted_at is null
        /* As text, so it is a filter and not an index: as an index the
           planner ANDed the workspace's million rows into the bitmap. */
        and h.workspace_id::text = current_workspace()::text
      limit 2000
    )
    select m.id, m.conversation_id, m.parent_id, coalesce(m.said_as, a.name), m.created_at,
           substr(m.said, greatest(1, strpos(lower(m.said), lower($3)) - 32), 96)
    from hit
    join message m on m.id = hit.id
    join actor a on a.id = m.author_id
    join conversation cv on cv.id = m.conversation_id
    where m.said ilike $1
      and m.created_at < $4
      and m.workspace_id = current_workspace()
      and m.conversation_id in (select visible_conversations())
      and ($2::uuid is null or cv.project_id = $2)
    order by m.created_at desc
    limit $5
  $q$
  using pattern, p_project, p_q, edge, 20 - found, words;
end $$;

grant execute on function search_messages(text, uuid) to tracker_app;
