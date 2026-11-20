/**
 * Days on this device's calendar, written the way the API writes a date.
 *
 * `new Date().toISOString().slice(0, 10)` is the day in Greenwich, and it
 * was how "today" was worked out in six places: a task due today was drawn
 * late from one in the morning in Paris and from five in the afternoon in
 * California, and a room put two messages either side of 01:00 under two
 * dividers with the same date. The server asks the account's zone the same
 * question — `server/src/day.ts`.
 */
export function onCalendar(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function today(): string {
  return onCalendar(new Date())
}

/** The day `n` days after `day` — counted in days, not in 86 400 seconds,
    which a change of clock makes 23 or 25 hours. */
export function daysAfter(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return onCalendar(new Date(y!, m! - 1, d! + n))
}
