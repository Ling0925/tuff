/*
 * The rest of the worker's functions, the worker's alone — after 153.
 *
 * The clear-out, the morning mail, the reminders, the pushes and the note
 * to operators about new accounts take ids from their caller and read
 * across every workspace. Only the worker calls them, and with this the
 * worker can run everything else as the application role, under row-level
 * security like any request: until now it connected as the database's
 * owner, which every policy lets through — its GitHub sync, made of calls
 * to the REST API, included.
 */
revoke execute on function purge_deleted(int) from public, tracker_app;
revoke execute on function new_accounts_claim() from public, tracker_app;
revoke execute on function operator_emails() from public, tracker_app;
revoke execute on function digest_due() from public, tracker_app;
revoke execute on function digest_claim(uuid) from public, tracker_app;
revoke execute on function claim_due_reminders() from public, tracker_app;
revoke execute on function due_notifications(int, uuid) from public, tracker_app;
revoke execute on function notification_sent(uuid) from public, tracker_app;
revoke execute on function push_told(uuid, int) from public, tracker_app;
revoke execute on function push_used(uuid) from public, tracker_app;
revoke execute on function push_subscription_gone(uuid) from public, tracker_app;
revoke execute on function push_about(uuid, object_kind, uuid) from public, tracker_app;

grant execute on function purge_deleted(int) to tracker_worker;
grant execute on function new_accounts_claim() to tracker_worker;
grant execute on function operator_emails() to tracker_worker;
grant execute on function digest_due() to tracker_worker;
grant execute on function digest_claim(uuid) to tracker_worker;
grant execute on function claim_due_reminders() to tracker_worker;
grant execute on function due_notifications(int, uuid) to tracker_worker;
grant execute on function notification_sent(uuid) to tracker_worker;
grant execute on function push_told(uuid, int) to tracker_worker;
grant execute on function push_used(uuid) to tracker_worker;
grant execute on function push_subscription_gone(uuid) to tracker_worker;
grant execute on function push_about(uuid, object_kind, uuid) to tracker_worker;
