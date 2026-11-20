/*
 * What somebody said, by week — the person's page counts it.
 * Without this, counting one person's messages
 * walked every message the reader can see, and the load table holds a
 * million in one channel.
 */
create index message_by_author on message (author_id, created_at) where deleted_at is null;
