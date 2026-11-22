/*
 * A session says what it was traded from, first of two files,
 * `312b` is the second.
 *
 * `traded_from` on a session: the one whose refresh token was spent to
 * make it, written by the sign-in role's insert in the transaction that
 * spends the token (`refresh` in `auth/flows.ts`). A refresh asked again
 * finds the answer it was given by it.
 *
 * Alone in its file, because of the lock. Adding a column takes ACCESS
 * EXCLUSIVE on `refresh_session`, and every request reads that table
 * (`auth_session_alive`, inside the statement that asks who is asking): for
 * as long as the lock is held, every request waits. On the service each
 * file is its own transaction (`server/src/db/migrate.ts`), so in a file
 * of its own the lock is held for the moment a nullable column with no
 * default takes to write into the catalogue, and is let go at this file's
 * commit. Written beside the indexes, as it first was, it was held while
 * both of them read the whole table.
 *
 * Changes no rows. `if not exists`, so a column added by hand beforehand
 * is taken as it is.
 */

alter table refresh_session add column if not exists traded_from uuid;

comment on column refresh_session.traded_from is
  'The session whose refresh token was spent to make this one, written in the same transaction. Null for a sign-in, and for rows from before 312.';
