import { now } from './words.js'

/**
 * How long, as a person reads it, and which day they are on.
 *
 * The column is minutes and nobody thinks in minutes. There was a parser
 * here too, taking `1h 30m` and `1.5h` and refusing what it could not read —
 * and it went the day the field became a menu. Picking a duration is not
 * something that can be mistyped, so there is nothing to parse and nothing
 * to refuse.
 */

/**
 * The way it is said back: `1h 30m`, `45m`, `2h` — and in French `1 h 30`,
 * `45 min`, `2 h`, the units apart from the number as French writes them.
 *
 * Never `90 minutes`, which is not how anybody says it, and never `1.5h`,
 * which turns a quarter of an hour into `0.25`.
 */
export function asHours(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (now === 'fr') {
    if (!h) return `${m}\u00a0min`
    return m ? `${h}\u00a0h\u00a0${String(m).padStart(2, '0')}` : `${h}\u00a0h`
  }
  if (!h) return `${m}m`
  return m ? `${h}h ${m}m` : `${h}h`
}

/* Today, where the person is: an hour logged at half past midnight in Paris
   belongs to the day it was logged on. */
export { today } from './calendar.js'
