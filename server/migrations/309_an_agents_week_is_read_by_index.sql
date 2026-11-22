/*
 * What an agent did this week.
 *
 * Three reads its page makes, each by the agent: the feed's lines that
 * gave it a task, the questions it asked, and the spend it sent. None of
 * the three had an index that starts with that agent, so each was a scan
 * of a workspace's feed, every comment, or every spend line, under the
 * reader's policies row by row.
 *
 * Indexes only: nothing here changes who may read what.
 */

/* The lines that gave somebody a task carry their ids since this
   (`given_ids`, beside the names in `given_to`). Partial, so the rest of
   the feed costs the index nothing. */
create index activity_given on activity_event using gin ((meta -> 'given_ids'))
  where meta ? 'given_ids';

/* The questions an agent asked, newest first. */
create index comment_asked_by on comment (author_id, created_at)
  where choices is not null and deleted_at is null;

/* What one actor's clients reported, by when it was last reported. */
create index task_spend_by_actor on task_spend (actor_id, updated_at)
  where deleted_at is null;
