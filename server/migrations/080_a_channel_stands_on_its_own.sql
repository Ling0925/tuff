-- A channel that belongs to no project.
--
-- A room was a project's channel when it had a project and a direct
-- conversation when it had none, so "no project" meant "between people". A
-- channel for the whole studio, or for the four people planning an offsite,
-- belongs to no project and is still a channel: named, renamed, joined and
-- left by more than the people who opened it. So it is said, not inferred.
--
-- Who may see one is unchanged: a channel outside a project is reached the
-- way a direct conversation is, through its member rows — "everyone" is
-- everybody in the workspace when it was made, written down as rows. The
-- policies already say exactly that, so none of them moves.
alter table conversation add column channel boolean not null default false;
alter table conversation add column created_by uuid references actor(id);
update conversation set channel = true where project_id is not null;

-- And a project's own room is `main`, as in Slack: the project is already
-- in its name, and "Team" said nothing the project did not.
update conversation set name = 'main' where project_id is not null and name = 'Team';

-- A project's room is a channel by being a project's, whichever path made it.
create function conversation_in_a_project_is_a_channel() returns trigger
language plpgsql as $$
begin
  new.channel := new.channel or new.project_id is not null;
  return new;
end $$;

create trigger conversation_channel before insert or update of project_id on conversation
  for each row execute function conversation_in_a_project_is_a_channel();
