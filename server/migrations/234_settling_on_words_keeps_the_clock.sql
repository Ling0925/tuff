/*
 * What the review of comments on words found.
 *
 * 1. Marking a thread's words writes the document's body, and the touch
 *    trigger moved `file.updated_at` with it: Docs, ordered by that clock,
 *    put the document first, and the public page said it had just been
 *    changed, for a comment. A write may now say it keeps the clock, for
 *    the length of its transaction (`tracker.keep_clock`), and only the
 *    anchor's write does.
 *
 * 2. Only a written document's thread is anchored: the check said "a
 *    file", which an upload and a link are too. The file is asked when the
 *    anchor is written.
 */

-- 1.
create or replace function touch_file_updated_at() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('tracker.keep_clock', true), 'off') <> 'on' then
    new.updated_at = now();
  end if;
  return new;
end $$;
grant execute on function touch_file_updated_at() to tracker_app;
drop trigger if exists touch on file;
create trigger touch before update on file
  for each row execute function touch_file_updated_at();

-- 2.
create or replace function comment_anchor_on_a_document() returns trigger
language plpgsql as $$
begin
  if new.quote is not null and not exists (
    select 1 from file f
    where f.id = new.object_id and f.body is not null and f.storage_key is null and f.url is null
  ) then
    raise exception 'an anchor is on a written document' using errcode = '23514';
  end if;
  return new;
end $$;
grant execute on function comment_anchor_on_a_document() to tracker_app;
drop trigger if exists comment_anchor_on_a_document on comment;
create trigger comment_anchor_on_a_document before insert or update of quote on comment
  for each row execute function comment_anchor_on_a_document();
