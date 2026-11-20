/*
 * An agent asks a question with the answers written, and a person presses
 * one.
 *
 * Not a new thing: a comment on a task that starts a thread, carrying its
 * choices and who it was asked of, and once answered, which choice, who
 * pressed it and when.
 */
alter table comment add column choices jsonb;
alter table comment add column asked uuid[];
alter table comment add column answer smallint;
alter table comment add column answered_by uuid references actor(id) on delete set null;
alter table comment add column answered_at timestamptz;

/* Only a comment on a task that starts a thread asks; two to four choices;
   an answer is one of them, with who and when, or none of the three. */
alter table comment add constraint comment_question_shape check (
  (choices is null and asked is null and answer is null and answered_by is null and answered_at is null)
  or (
    object_type = 'task' and parent_id is null
    and jsonb_typeof(choices) = 'array'
    and jsonb_array_length(choices) between 2 and 4
    and asked is not null and cardinality(asked) between 1 and 10
    and ((answer is null and answered_at is null)
         or (answer is not null and answered_at is not null
             and answer >= 0 and answer < jsonb_array_length(choices)))
  )
);

/*
 * What was asked, and of whom, never changes; an answer is written once.
 * The touch trigger already leaves the clock alone for these columns (it
 * fires on body, parent, object and deletion), so an answer does not make
 * the question read "edited".
 */
create function question_stays_as_asked() returns trigger
language plpgsql as $$
begin
  if new.choices is distinct from old.choices or new.asked is distinct from old.asked then
    raise exception 'a question keeps its choices and who it asked'
      using errcode = 'check_violation';
  end if;
  if old.answered_at is not null and (
       new.answer is distinct from old.answer
       or new.answered_by is distinct from old.answered_by
       or new.answered_at is distinct from old.answered_at) then
    raise exception 'a question is answered once'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger question_stays_as_asked
  before update of choices, asked, answer, answered_by, answered_at on comment
  for each row execute function question_stays_as_asked();

/* The questions still open, by who was asked — the inbox's Needs you. */
create index comment_open_questions on comment using gin (asked)
  where choices is not null and answered_at is null and deleted_at is null;

/*
 * Answering. The question is the agent's comment, and `cmt_update` lets
 * only its author and the project's runners change it — so a definer that
 * writes the three columns of the answer and nothing else, on a question
 * the asker can read (its task under the task's own policies) and that has
 * no answer yet. The application has asked `can()` first.
 *
 * Answers 'done', 'answered' when somebody was first, 'out_of_range' for a
 * choice that is not one, and 'missing' for anything else.
 */
create function answer_question(q uuid, pick int) returns text
  language plpgsql security definer set search_path = public, pg_temp
  as $$
declare
  q_row comment%rowtype;
begin
  select c.* into q_row from comment c
   where c.id = q and c.deleted_at is null and c.choices is not null
     and c.object_type = 'task'
     and (current_workspace() is null or c.workspace_id = current_workspace())
     and c.project_id in (select visible_projects())
     and exists (select 1 from task t where t.id = c.object_id and t.deleted_at is null
                   and t.project_id in (select visible_projects()))
   for update;
  if not found then
    return 'missing';
  end if;
  if q_row.answered_at is not null then
    return 'answered';
  end if;
  if pick < 0 or pick >= jsonb_array_length(q_row.choices) then
    return 'out_of_range';
  end if;
  update comment set answer = pick, answered_by = current_actor(), answered_at = now()
   where id = q;
  return 'done';
end $$;
revoke all on function answer_question(uuid, int) from public;
grant execute on function answer_question(uuid, int) to tracker_app;

/* Its own reason in the inbox, so it can be counted and pushed as one. */
alter type notify_reason add value if not exists 'asked';
