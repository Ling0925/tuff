/*
 * A comment on words in a document.
 *
 * Not a new thing: a comment on the file, starting a thread, whose words
 * are marked in the document's body with the comment's own id. What the
 * row keeps is the words as they were when it was made, so a thread can
 * say what it was on after the words have gone, and whether it has been
 * settled, by whom.
 */
alter table comment add column quote text;
alter table comment add column resolved_at timestamptz;
alter table comment add column resolved_by uuid references actor(id) on delete set null;

/* Only a thread on a document's words is anchored or resolved: never a
   reply, never a comment on a task, an announcement or a message. */
alter table comment add constraint comment_anchor_starts_a_thread check (
  (quote is null and resolved_at is null and resolved_by is null)
  or (object_type = 'file' and parent_id is null and quote is not null)
);
alter table comment add constraint comment_quote_is_short check (quote is null or length(quote) <= 500);

/*
 * Settling a thread is not editing what was said, and must not make the
 * comment read "edited": `edited_at` is `updated_at` past `created_at`.
 * The comment's clock moves for a change to what it says or where it is,
 * and not for the two columns of settling.
 */
drop trigger touch on comment;
create trigger touch before update of body, parent_id, object_id, object_type, deleted_at on comment
  for each row execute function touch_updated_at();

/*
 * Settling a thread, or opening it again. Whoever may comment on the
 * document may do either, and the thread is usually somebody else's — so
 * not through `cmt_update`, which lets a person change only their own
 * comments and must go on doing so. This touches the two columns of
 * settling and nothing else, on a thread the asker can read: the
 * application has read it under every policy in the same transaction
 * first, and this asks the read policy's own question again.
 */
create function resolve_thread(thread uuid, settle boolean) returns boolean
  language plpgsql security definer set search_path = public, pg_temp
  as $$
declare n int;
begin
  update comment c
     set resolved_at = case when settle then coalesce(c.resolved_at, now()) end,
         resolved_by = case when settle then coalesce(c.resolved_by, current_actor()) end
   where c.id = thread and c.quote is not null and c.parent_id is null and c.deleted_at is null
     and c.project_id in (select visible_projects());
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke all on function resolve_thread(uuid, boolean) from public;
grant execute on function resolve_thread(uuid, boolean) to tracker_app;
