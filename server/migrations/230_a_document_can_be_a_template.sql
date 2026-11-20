-- A written document saved as a template.
--
-- A template is a document with a mark on it, not a fifth entity: it stays
-- in its project's Docs, is read and edited as any document is, and is
-- offered to "New document" anywhere in the workspace to whoever can read
-- its project. Who may see one is the file's own `o_read` policy, so a
-- template in a project somebody is not on is not offered to them and
-- cannot be made from.
alter table file add column if not exists template_at timestamptz;

-- "New document" lists them across the workspace, newest first.
create index if not exists file_templates on file (workspace_id, template_at desc)
  where template_at is not null and deleted_at is null;
