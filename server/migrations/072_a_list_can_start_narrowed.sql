/*
 * A list can start narrowed on a board.
 *
 * Narrowing a column is remembered on the machine it was done on; this is
 * only where a board starts when that machine has no answer yet. Set for the
 * Canceled a new project starts with — what was not going to be done is
 * looked at rarely, and a full column of it is a fifth of the board spent on
 * it. False for every list that exists already, so no board anybody has
 * looked at changes.
 */
alter table task_list add column narrow boolean not null default false;
