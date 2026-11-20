-- A folder is the fourth kind of file: a row with none of the three places to
-- read from. That is what a folder is — a name other rows point at — and it
-- keeps the comment, version and client-visibility rules in one place instead
-- of four.
--
-- The inference is only safe once the existing rows agree with it. A document
-- created before this could be inserted with a null body, and from now on a
-- null body means folder — so every one of those would quietly become a
-- folder on the next read. Nothing would throw and the document would be
-- gone from the list.
update file
set body = '{}'::jsonb
where body is null and url is null and storage_key is null and deleted_at is null;
