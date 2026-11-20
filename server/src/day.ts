import type { Tx } from './db.js'

/*
 * The day it is for whoever is asking, not in Greenwich.
 *
 * `current_date` is the database's day, and the database runs in UTC: a task
 * due today turned late at one in the morning in Paris and at five in the
 * afternoon in California, while the person it was due for was still at
 * work. Late is "the day it was due has ended where you are", and the zone is
 * the one the account holds — which the browser sets the first time it opens
 * the app (`docs/specs/person-card.md`).
 *
 * Fragments, to be written into a query: the zone is read in the same
 * statement, not in a round trip of its own.
 */
export const zoneOf = (tx: Tx, actorId: string) => tx`coalesce((select u.timezone from app_user u where u.actor_id = ${actorId}), 'UTC')`

export const todayFor = (tx: Tx, actorId: string) => tx`(now() at time zone ${zoneOf(tx, actorId)})::date`
