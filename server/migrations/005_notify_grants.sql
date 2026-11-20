-- Migration 002 grants app_user column by column, so that a password hash is
-- refused by the database rather than by every select list staying correct.
-- The columns 004 added were therefore readable by nobody, and notifying
-- anyone failed with "permission denied" the moment quiet hours were checked.
--
-- The cost of the strict grant is exactly this: a new column is invisible
-- until it is named. That is the right trade, and it is why this migration
-- exists rather than a blanket grant.
grant select (notify_chat, quiet_from, quiet_to, timezone) on app_user to tracker_app;
grant update (notify_chat, quiet_from, quiet_to, timezone) on app_user to tracker_app;
