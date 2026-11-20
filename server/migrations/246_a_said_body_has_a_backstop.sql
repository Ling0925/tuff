/*
 * The database's own backstop under the ceiling on something said,
 * the review of finding 5.
 *
 * The ceiling is the request's (128 KB, `routes.ts`), and every road the
 * product writes a comment or a message by is under it or a limit of its
 * own: the importers count characters, Slack's history is 40 000 of them,
 * GitHub's comments 65 536. A road somebody adds later and forgets is what
 * this is for, so it is set well past all of them — 512 KB of the body as
 * the database writes it out, which is more than the request (jsonb's text
 * puts a space after every colon and comma) — and is never what refuses a
 * request the ceiling let through.
 *
 * A trigger on writing a body rather than a check: a check is asked of
 * every update, and a row written before there was a ceiling could then
 * not even be deleted or resolved. This asks only when a body is written,
 * and reads no row already there.
 *
 * Task and announcement bodies are left without one: a page brought in by
 * the Markdown import may legitimately be larger than its request, and the
 * reads that carry many of those are lists that do not send bodies.
 *
 * Changes no rows.
 */
create function said_body_most() returns trigger
language plpgsql as $$
begin
  if new.body is not null and octet_length(new.body::text) > 524288 then
    raise exception 'too_large' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger comment_body_most before insert or update of body on comment
  for each row execute function said_body_most();
create trigger message_body_most before insert or update of body on message
  for each row execute function said_body_most();
