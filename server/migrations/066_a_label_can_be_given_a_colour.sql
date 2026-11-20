/*
 * A label can be given a colour, and the starters are named for what they are.
 *
 * The labels spec argued the other way and is being overruled by the
 * product's author, so the argument is worth keeping rather than deleting:
 * a colour taken from the id is already decided, and a workspace that has to
 * agree on a colour for "bug" is a workspace having a meeting about a colour.
 *
 * What that missed is that the three words a workspace starts with are not
 * arbitrary. Red for a bug, blue for a feature and purple for an improvement
 * are conventions a person arrives already knowing, and a hash that paints
 * "bug" green is not neutral — it is wrong in a way the reader can see. The
 * setting is not a team deciding a palette; it is a label being allowed to
 * look like what it means.
 *
 * Null is the ordinary state and keeps the old behaviour exactly: the chip
 * works the colour out from the id, as every label does today. So this adds
 * a choice without taking the decision away from anybody who does not make
 * one, and nothing that exists changes colour.
 */
alter table label add column color text;

/*
 * The three a workspace starts with, in Title Case and in the colours the
 * words already carry.
 *
 * `question` and `client` go. They were chosen to show what labels are for,
 * which they did; what people actually reach for first is the kind of work,
 * and a vocabulary somebody inherits should be the one they would have
 * written. A workspace that wants either back types it, which is the whole
 * point of labels being ordinary rows.
 */
create or replace function starting_labels(p_workspace_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into label (id, workspace_id, name, color)
  select gen_random_uuid(), p_workspace_id, name, color
  from (values
    ('Bug', 'red'),
    ('Feature', 'blue'),
    ('Improvement', 'purple')
  ) as starting(name, color)
  on conflict (workspace_id, name) where deleted_at is null do nothing;
end $$;

/*
 * The workspaces that already exist get the colours and the capitals.
 *
 * `name` is `citext`, so "bug" and "Bug" are the same row to the unique
 * index and renaming one cannot collide with the other. Only the untouched
 * ones are changed: a label somebody has already given a colour to is their
 * answer, and this is not entitled to overwrite it.
 */
update label set name = 'Bug', color = coalesce(color, 'red')
  where name = 'bug' and deleted_at is null;
update label set name = 'Feature', color = coalesce(color, 'blue')
  where name = 'feature' and deleted_at is null;
update label set name = 'Improvement', color = coalesce(color, 'purple')
  where name = 'improvement' and deleted_at is null;

/* And every workspace is offered the new set, including the two words that
   did not exist before. Nothing is removed: `question` and `client` stay
   wherever somebody is already using them. */
do $$
declare w record;
begin
  for w in select id from workspace loop
    perform starting_labels(w.id);
  end loop;
end $$;
