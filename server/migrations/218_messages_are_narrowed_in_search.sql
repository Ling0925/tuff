/*
 * Narrowing the messages search finds.
 *
 * `search_messages` with four filters and a direction: from one person,
 * with a link, with a file, in a thread; newest or oldest first. The words
 * are matched as they always were, and may be left out once a filter is
 * on — "files from Lee" is a question with no words in it.
 *
 * The same two steps, for the same reason (migration 170): a window read
 * through an index on when things were said, and only when it does not
 * fill twenty, anything past it by its words. From one person the window
 * is that person's own messages, through `message_by_author`, so somebody
 * who says little is not lost among everybody's newest twenty thousand.
 * Oldest first reads the window from the other end. With no words, past
 * the window there is nothing to look things up by, and the answer is
 * what the window held.
 *
 * Kept beside `search_messages` rather than replacing it, so the apps that
 * ask the old way are answered as before.
 */

create function search_messages_by(
  p_q text, p_project uuid, p_from uuid, p_link boolean, p_file boolean, p_thread boolean, p_oldest boolean
)
returns table (id uuid, conversation_id uuid, parent_id uuid, author_name text, created_at timestamptz, snippet text)
language plpgsql stable security definer set search_path = public as $$
declare
  q text := coalesce(p_q, '');
  pattern text := '%' || replace(replace(replace(coalesce(p_q, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  narrowed boolean := p_from is not null or coalesce(p_link, false) or coalesce(p_file, false) or coalesce(p_thread, false);
  dir text := case when coalesce(p_oldest, false) then 'asc' else 'desc' end;
  edge timestamptz;
  found int;
  words text;
  filters text := $f$
      and ($5::uuid is null or (m.author_id = $5 and m.said_as is null))
      and (not $6 or m.said ~* '(https?://|www\.)\S' or m.body @? '$.** ? (@.type == "link" || @.type == "preview")')
      and (not $7 or m.body @? '$.** ? (@.type == "attachment")')
      and (not $8 or m.parent_id is not null)
      and (length($3) = 0 or m.said ilike $1)
      and m.conversation_id in (select visible_conversations())
      and ($2::uuid is null or cv.project_id = $2)
  $f$;
begin
  if current_workspace() is null then
    return;
  end if;
  /* Three letters, as before — or any, once something narrows it. */
  if length(q) < 3 and not narrowed then
    return;
  end if;

  /* Where the window ends — the twenty-thousandth message from that end,
     of everybody's or of the one person's; null when that is all of them. */
  if p_from is not null then
    execute format($e$
      select m.created_at from message m
      where m.author_id = $1 and m.workspace_id = current_workspace() and m.deleted_at is null
      order by m.created_at %s offset 19999 limit 1$e$, dir) into edge using p_from;
  else
    execute format($e$
      select m.created_at from message m
      where m.workspace_id = current_workspace() and m.deleted_at is null
      order by m.created_at %s offset 19999 limit 1$e$, dir) into edge;
  end if;

  return query execute format($q$
    select m.id, m.conversation_id, m.parent_id, coalesce(m.said_as, a.name), m.created_at,
           substr(m.said, greatest(1, strpos(lower(m.said), lower($3)) - 32), 96)
    from (select * from message r
          where r.workspace_id = current_workspace() and r.deleted_at is null
            and ($5::uuid is null or r.author_id = $5)
            and ($4::timestamptz is null or (case when $9 then r.created_at <= $4 else r.created_at >= $4 end))
          order by r.created_at %1$s limit 20000) m
    join actor a on a.id = m.author_id
    join conversation cv on cv.id = m.conversation_id
    where true %2$s
    order by m.created_at %1$s
    limit 20
  $q$, dir, filters)
  using pattern, p_project, q, edge, p_from, coalesce(p_link, false), coalesce(p_file, false), coalesce(p_thread, false),
        coalesce(p_oldest, false);
  get diagnostics found = row_count;
  if found >= 20 or edge is null or length(q) < 3 then
    return;
  end if;

  /* Past the window, by its words: each a word or the start of one. */
  select string_agg(quote_literal(w) || ':*', ' & ') into words
  from regexp_split_to_table(lower(q), '[^[:alnum:]]+') w where w <> '';
  if words is null then
    return;
  end if;
  return query execute format($q$
    with hit as materialized (
      select h.id from message h
      where to_tsvector('simple', h.said) @@ to_tsquery('simple', $10) and h.deleted_at is null
        /* As text, so it is a filter and not an index — migration 170. */
        and h.workspace_id::text = current_workspace()::text
      limit 2000
    )
    select m.id, m.conversation_id, m.parent_id, coalesce(m.said_as, a.name), m.created_at,
           substr(m.said, greatest(1, strpos(lower(m.said), lower($3)) - 32), 96)
    from hit
    join message m on m.id = hit.id
    join actor a on a.id = m.author_id
    join conversation cv on cv.id = m.conversation_id
    where m.workspace_id = current_workspace()
      and (case when $9 then m.created_at > $4 else m.created_at < $4 end)
      %2$s
    order by m.created_at %1$s
    limit $11
  $q$, dir, filters)
  using pattern, p_project, q, edge, p_from, coalesce(p_link, false), coalesce(p_file, false), coalesce(p_thread, false),
        coalesce(p_oldest, false), words, 20 - found;
end $$;

revoke execute on function search_messages_by(text, uuid, uuid, boolean, boolean, boolean, boolean) from public;
grant execute on function search_messages_by(text, uuid, uuid, boolean, boolean, boolean, boolean) to tracker_app;
