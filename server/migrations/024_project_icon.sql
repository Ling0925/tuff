-- A picture of its own, for a project that wants one.
--
-- The generated mark is derived from the id, so it is stable and different
-- between two projects whose names start the same — which initials are not.
-- It is the default and not a placeholder: most projects will keep it.
--
-- A storage key rather than a url: the bytes live where every other upload
-- lives, behind the same signed links, so a project image is not the one
-- thing in the product anybody can read by guessing a name.
alter table project add column icon_key text;
