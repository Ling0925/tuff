/*
 * Hours on one task.
 *
 * `time_entry.object_type` and `object_id` have been there since the first
 * schema and nothing ever read them, so nothing ever needed to find rows by
 * them. The task screen does now, and without this the answer to "how long
 * has this taken" is a sequential scan of every hour anybody has logged —
 * cheap on demo data, and the load table has a million of them.
 *
 */
create index time_entry_by_object on time_entry (object_type, object_id, spent_on)
  where object_id is not null and deleted_at is null;
