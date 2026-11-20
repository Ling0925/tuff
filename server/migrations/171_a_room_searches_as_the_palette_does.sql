/*
 * A room's own search the way the palette's search of messages works —
 * `docs/specs/find.md`.
 *
 * It asked the trigram index for the whole room, and in a room of a
 * million messages that all say "Message", "Message 4242" read every entry
 * of every one of its trigrams: 27 ms on one run and 365 on the next,
 * against a budget of 200. Now the room's newest twenty thousand are read
 * first, newest first through the room's own index, and only when they do
 * not fill the page is anything older looked for — by its words, led by
 * the rare one, as `search_messages` does.
 */
create or replace function search_room(p_room uuid, p_q text, p_before timestamptz, p_limit int)
returns table (id uuid, body jsonb, author_id uuid, author_name text, said_as text, author_avatar text,
               parent_id uuid, created_at timestamptz, edited_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare
  pattern text := '%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  wanted int := least(p_limit, 30);
  edge timestamptz;
  found int;
  words text;
begin
  if not can_see_conversation(p_room) then
    return;
  end if;
  /* Where the room's newest twenty thousand before the cursor end; null
     when that is all of them. */
  select m.created_at into edge from message m
  where m.conversation_id = p_room and m.deleted_at is null
    and (p_before is null or m.created_at < p_before)
  order by m.created_at desc offset 19999 limit 1;

  return query execute $q$
    select m.id, m.body,
           case when m.said_as is null then m.author_id end,
           coalesce(m.said_as, a.name), m.said_as,
           case when m.said_as is null then a.avatar_key end,
           m.parent_id, m.created_at, m.edited_at
    from (select * from message r
          where r.conversation_id = $1 and r.deleted_at is null
            and ($3::timestamptz is null or r.created_at < $3)
          order by r.created_at desc limit 20000) m
    join actor a on a.id = m.author_id
    where m.said ilike $2
    order by m.created_at desc
    limit $4
  $q$
  using p_room, pattern, p_before, wanted;
  get diagnostics found = row_count;
  if found >= wanted or edge is null then
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
      where to_tsvector('simple', h.said) @@ to_tsquery('simple', $5) and h.deleted_at is null
        /* As text, so it is a filter and not an index: as an index the
           planner ANDed the room's million rows into the bitmap. */
        and h.conversation_id::text = $1::text
      limit 2000
    )
    select m.id, m.body,
           case when m.said_as is null then m.author_id end,
           coalesce(m.said_as, a.name), m.said_as,
           case when m.said_as is null then a.avatar_key end,
           m.parent_id, m.created_at, m.edited_at
    from hit
    join message m on m.id = hit.id
    join actor a on a.id = m.author_id
    where m.said ilike $2 and m.created_at < $3
    order by m.created_at desc
    limit $4
  $q$
  using p_room, pattern, edge, wanted - found, words;
end $$;
