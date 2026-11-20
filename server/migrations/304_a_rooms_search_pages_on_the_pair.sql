/*
 * A room's search pages on the moment and the id,
 *
 * Its cursor was the last message's time alone, handed to `p_before
 * timestamptz` — which the driver sends through a JavaScript Date, to the
 * millisecond — and read as "before it": messages in the same millisecond as
 * a page's last were never found on the next page, and two said in one
 * moment were told apart by nothing. Now the cursor is the room history's,
 * `<moment>_<id>`, the moment sent as text and cast in the call, and the
 * order is the moment and then the id, the window's edge included.
 *
 * Everything else as migration 171 left it. Changes no rows.
 *
 * A new function beside the old one rather than in its place: the server
 * still running while this one comes up asks the four-argument
 * `search_room` until it is gone, and a dropped one was its search failing
 * for that minute. Nothing in this build calls the old one; a later
 * migration drops it.
 */

create function search_room(p_room uuid, p_q text, p_before_at timestamptz, p_before_id uuid, p_limit int)
returns table (id uuid, body jsonb, author_id uuid, author_name text, said_as text, author_avatar text,
               parent_id uuid, created_at timestamptz, edited_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  pattern text := '%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  wanted int := least(p_limit, 30);
  edge_at timestamptz;
  edge_id uuid;
  found int;
  words text;
begin
  if not can_see_conversation(p_room) then
    return;
  end if;
  /* Where the room's newest twenty thousand before the cursor end; null
     when that is all of them. A cursor with no id (a bare moment, from
     before) is "before that moment": the pair against a null id is null
     on the moment itself. */
  select m.created_at, m.id into edge_at, edge_id from message m
  where m.conversation_id = p_room and m.deleted_at is null
    and (p_before_at is null
         or (m.created_at <= p_before_at and (m.created_at < p_before_at or m.id < p_before_id)))
  order by m.created_at desc, m.id desc offset 19999 limit 1;

  return query execute $q$
    select m.id, m.body,
           case when m.said_as is null then m.author_id end,
           coalesce(m.said_as, a.name), m.said_as,
           case when m.said_as is null then a.avatar_key end,
           m.parent_id, m.created_at, m.edited_at
    from (select * from message r
          where r.conversation_id = $1 and r.deleted_at is null
            and ($3::timestamptz is null
                 or (r.created_at <= $3 and (r.created_at < $3 or r.id < $5)))
          order by r.created_at desc, r.id desc limit 20000) m
    join actor a on a.id = m.author_id
    where m.said ilike $2
    order by m.created_at desc, m.id desc
    limit $4
  $q$
  using p_room, pattern, p_before_at, wanted, p_before_id;
  get diagnostics found = row_count;
  if found >= wanted or edge_at is null then
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
    where m.said ilike $2 and m.created_at <= $3 and (m.created_at < $3 or m.id < $6)
    order by m.created_at desc, m.id desc
    limit $4
  $q$
  using p_room, pattern, edge_at, wanted - found, words, edge_id;
end $$;

revoke all on function search_room(uuid, text, timestamptz, uuid, int) from public;
grant execute on function search_room(uuid, text, timestamptz, uuid, int) to tracker_app;
