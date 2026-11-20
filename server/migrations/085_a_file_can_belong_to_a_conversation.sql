-- A file sent in a conversation that belongs to no project.
--
-- A file was a row in a project's Docs and nothing else, so a direct
-- message or a channel of the workspace's own had no clip at all: there was
-- no project to put the file in. Now a file belongs to a project or to a
-- conversation, never neither, and who may see it follows whichever it
-- belongs to — the project's people, or the room's.
alter table file alter column project_id drop not null;
alter table file add column conversation_id uuid references conversation(id);
alter table file add constraint file_has_a_home
  check (project_id is not null or conversation_id is not null);
create index file_conversation on file (conversation_id) where conversation_id is not null;

drop policy o_read on file;
create policy o_read on file for select using (
  project_id in (select visible_projects())
  or (project_id is null and conversation_id in (select visible_conversations()))
);

drop policy o_update on file;
create policy o_update on file for update using (
  project_id in (select visible_projects())
  or (project_id is null and conversation_id in (select visible_conversations()))
) with check (true);

drop policy o_write on file;
create policy o_write on file for insert with check (
  author_id = current_actor() and (
    project_id in (select visible_projects())
    or (project_id is null and conversation_id in (select visible_conversations()))
  )
);

-- A file's number is its place in its project's counter;
-- a room's own file has no project to count in
-- and no address of that shape, so it has none.
alter table file alter column number drop not null;
alter table file add constraint file_numbered_in_its_project
  check (project_id is null or number is not null);
