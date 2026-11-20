-- Tasks are numbered on their own.
--
-- One counter per project was shared by tasks, posts and files, so a task
-- made after three pictures were pasted into a description was NEW-22 after
-- NEW-18 — and the number with the project's key in front of it is shown
-- only on tasks, so the gaps were visible exactly where people read numbers
-- as a sequence. Tasks count on `task_seq` from here; posts and files keep
-- sharing `seq`. Numbers already given stay as they are: they are in links.
-- A task's counter starts at the highest task number its project has, so
-- nothing given out can be given again.
alter table project add column task_seq int not null default 0;

update project p
set task_seq = coalesce((select max(t.number) from task t where t.project_id = p.id), 0);

create function task_number_in_project() returns trigger
language plpgsql as $$
begin
  if new.number is null then
    update project set task_seq = task_seq + 1 where id = new.project_id
    returning task_seq into new.number;
  end if;
  return new;
end $$;

drop trigger task_number_in_project on task;
create trigger task_number_in_project before insert on task
  for each row execute function task_number_in_project();
