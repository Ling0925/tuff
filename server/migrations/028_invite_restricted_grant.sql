/*
 * The column the application role could not read.
 *
 * `invite` is one of four tables whose SELECT is granted column by column
 * rather than wholesale, because `token_hash` must not be selectable by
 * anything — migration 002. A grant written as a list is a grant that does
 * not grow: migration 027 added `restricted` to the table and nothing added
 * it to the list, so `GET /api/invites` answered 500 to every request.
 *
 * It did not show up sooner because the invite flow itself never reads the
 * table through the application role — `accept_invite` and `preview_invite`
 * are security definer and bypass the grant entirely. Only the list broke,
 * and until now nothing listed them.
 */
grant select (restricted) on invite to tracker_app;
