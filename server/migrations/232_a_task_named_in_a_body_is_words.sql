/*
 * A task named in a body is found by its words.
 *
 * A line of a document made into a task becomes a `taskref` node, which
 * holds its title as an attribute and has no text of its own, so the words
 * the line said dropped out of search the moment it became work. What a
 * body says now includes the title of every task it names, as the chip
 * shows it.
 *
 * `said` is a stored column, worked out when a row is written. The
 * documents, tasks and announcements that already name a task are written
 * again, with the clock that says "edited" held still: nothing about them
 * changed but what search reads. A room's messages are not rewritten — a
 * million rows read for the few that name a task with `#`; a message
 * written or edited from now on says the title.
 */
create or replace function words_of(body jsonb) returns text
  language sql immutable parallel safe
  as $$
    select coalesce(string_agg(coalesce(n ->> 'text', n -> 'attrs' ->> 'title'), ' '), '')
    from jsonb_path_query(body, 'strict $.** ? (@.type == "text" || @.type == "taskref")') n
  $$;

alter table file disable trigger touch;
update file set body = body where body is not null and body::text like '%"taskref"%';
alter table file enable trigger touch;

alter table task disable trigger touch;
update task set body = body where body is not null and body::text like '%"taskref"%';
alter table task enable trigger touch;

alter table post disable trigger touch;
update post set body = body where body is not null and body::text like '%"taskref"%';
alter table post enable trigger touch;
