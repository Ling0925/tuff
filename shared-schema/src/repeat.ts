import { z } from 'zod'

/**
 * A task's repeat rule, and the arithmetic of its next date.
 *
 * Here rather than in the server because two sides read it: the server makes
 * the next one with `nextDue`, and the picker on the web suggests rules from
 * the date it is showing with the same `filled`. One rule, one place.
 *
 * Every date here is `YYYY-MM-DD` and every sum is done on UTC dates. A due
 * date is a day on the calendar with no zone, and adding a week to it in
 * local time walks it an hour off at a clock change — at midnight, a day off.
 */

/** ISO weekday numbers: Monday 1 … Sunday 7. */
export const Weekday = z.int().min(1).max(7)

export const Repeat = z
  .object({
    every: z.enum(['day', 'week', 'month', 'year']),
    /** Every how many days, weeks, months or years. Absent means 1. */
    interval: z.int().min(1).max(99).optional(),
    /** For a week: the days it falls on, Monday 1 … Sunday 7. */
    weekdays: z.array(Weekday).min(1).max(7).optional(),
    /** For a month or a year: the day of the month, or -1 for the last. */
    day: z
      .int()
      .min(-1)
      .max(31)
      .refine((d) => d !== 0)
      .optional(),
    /** For a year: the month, 1 … 12. */
    month: z.int().min(1).max(12).optional(),
    /** From the old due date (the default), or from the day it was done. */
    from: z.enum(['due', 'done']).optional(),
  })
  .strict()
export type Repeat = z.infer<typeof Repeat>

const DAY = 86_400_000

function parse(on: string): { y: number; m: number; d: number } {
  const [y, m, d] = on.split('-').map(Number)
  return { y: y!, m: m!, d: d! }
}
function utc(on: string): number {
  const { y, m, d } = parse(on)
  return Date.UTC(y, m - 1, d)
}
function iso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}
/** Days in a month, `m` from 1. */
function daysIn(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}
/** ISO weekday of a date: Monday 1 … Sunday 7. */
export function weekdayOf(on: string): number {
  const w = new Date(utc(on)).getUTCDay()
  return w === 0 ? 7 : w
}
/* Which week a date is in, counted in Mondays from 5 January 1970. */
const MONDAY = Date.UTC(1970, 0, 5)
function weekOf(on: string): number {
  return Math.floor((utc(on) - MONDAY) / DAY / 7)
}
export function addDays(on: string, n: number): string {
  return iso(utc(on) + n * DAY)
}
/** A day of a month, the last day of it for -1 or for a day it does not have. */
function dayOf(y: number, m: number, day: number): string {
  const last = daysIn(y, m)
  const d = day === -1 ? last : Math.min(day, last)
  return iso(Date.UTC(y, m - 1, d))
}
/** Months on from a date, the day held where the month has it. */
function addMonths(on: string, n: number): string {
  const { y, m, d } = parse(on)
  const at = y * 12 + (m - 1) + n
  return dayOf(Math.floor(at / 12), (at % 12) + 1, d)
}

/**
 * The rule whole, its missing parts read off a date — the task's due date,
 * or today. "Every week" on a Friday is Fridays; "every month" on the 14th is
 * the 14th. What is stored is always whole, so reading it never needs the
 * date beside it. Counting from done needs none of them, and keeps none.
 */
export function filled(rule: Repeat, anchor: string): Repeat {
  const { m, d } = parse(anchor)
  const interval = rule.interval && rule.interval > 1 ? { interval: rule.interval } : {}
  if (rule.from === 'done') return { every: rule.every, ...interval, from: 'done' }
  if (rule.every === 'day') return { every: 'day', ...interval }
  if (rule.every === 'week') {
    const days = [...new Set(rule.weekdays?.length ? rule.weekdays : [weekdayOf(anchor)])].sort((a, b) => a - b)
    return { every: 'week', ...interval, weekdays: days }
  }
  if (rule.every === 'month') return { every: 'month', ...interval, day: rule.day ?? d }
  return { every: 'year', ...interval, month: rule.month ?? m, day: rule.day ?? d }
}

/** The first date after `after` that a whole rule names. */
function following(rule: Repeat, after: string): string {
  const n = rule.interval ?? 1
  if (rule.every === 'day') return addDays(after, n)
  if (rule.every === 'week') {
    const days = rule.weekdays?.length ? rule.weekdays : [weekdayOf(after)]
    /* Weeks counted from Monday to Monday; a day is on the rule when its
       week is a whole number of intervals from the old date's week. */
    for (let i = 1; i <= 7 * n + 7; i++) {
      const on = addDays(after, i)
      if ((weekOf(on) - weekOf(after)) % n === 0 && days.includes(weekdayOf(on))) return on
    }
    return addDays(after, 7 * n)
  }
  const { y, m } = parse(after)
  if (rule.every === 'month') {
    const day = rule.day ?? parse(after).d
    for (let k = 0; k <= 2; k++) {
      const at = y * 12 + (m - 1) + k * n
      const on = dayOf(Math.floor(at / 12), (at % 12) + 1, day)
      if (on > after) return on
    }
    return addMonths(after, n)
  }
  const month = rule.month ?? m
  const day = rule.day ?? parse(after).d
  for (let k = 0; k <= 2; k++) {
    const on = dayOf(y + k * n, month, day)
    if (on > after) return on
  }
  return dayOf(y + n, month, day)
}

/**
 * The next one's due date.
 *
 * `due` is the old due date or null; `today` is the finisher's day, in their
 * zone, worked out by whoever calls this. From the old date — so a late
 * Friday report stays on Fridays — and walked on until it is today or
 * later, so the next one is never born already late. Counting from done is
 * today plus the interval.
 */
export function nextDue(rule: Repeat, due: string | null, today: string): string {
  const n = rule.interval ?? 1
  if (rule.from === 'done') {
    if (rule.every === 'day') return addDays(today, n)
    if (rule.every === 'week') return addDays(today, 7 * n)
    if (rule.every === 'month') return addMonths(today, n)
    return addMonths(today, 12 * n)
  }
  let on = following(rule, due ?? today)
  /* Bounded: a daily rule on a date ten years gone is 3 650 steps, and a
     date the schema allows can be further. Past the bound, today's
     following date is the same answer reached at once. */
  for (let i = 0; on < today && i < 10_000; i++) on = following(rule, on)
  if (on < today) on = following(rule, addDays(today, -1))
  return on
}

/** Days between two dates, `b - a`. */
export function daysBetween(a: string, b: string): number {
  return Math.round((utc(b) - utc(a)) / DAY)
}
