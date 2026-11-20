/*
 * The worker waits for the schema it was built for.
 *
 * The server and the worker deploy together, and only the server migrates.
 * The worker came up first, ran its clear-out at once, and called a
 * function the migration half a minute later would make: one error line to
 * Better Stack on every deploy that adds what the worker uses. It reads
 * which migrations have run before it starts, so it needs to see the list.
 */
grant select on schema_migration to tracker_app;
