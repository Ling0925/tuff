/**
 * Moments in the zone the account keeps.
 *
 * A reminder's "tomorrow at nine" is nine where the person is, and where they
 * are is what their account says (`app_user.timezone`), which is the zone the
 * server reads the due-date reminders in. The browser's own zone is only the
 * stand-in until `/api/me` has said; on most machines the two are the same,
 * since the app tells the account the device's zone while it is the default.
 *
 * No library: the platform's `Intl` names the zones, and a wall clock in a
 * zone is turned into an instant by asking what the zone's clock reads at a
 * guess and correcting by the difference — twice, for the hour a clock
 * changes.
 */

let kept: string | null = null

/** Said by `/api/me`; anything the platform does not know is ignored. */
export function setZone(zone: string | null | undefined): void {
  if (!zone) return
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    kept = zone
  } catch {
    // A zone this browser cannot name: the device's stands in.
  }
}

export function myZone(): string {
  if (kept) return kept
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export type Clock = { y: number; m: number; d: number; h: number; mi: number; dow: number }

const readers = new Map<string, Intl.DateTimeFormat>()
const DOW: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }

/** What a clock in this zone reads at this instant. `dow` is 1 for Monday. */
export function clockIn(at: Date, zone = myZone()): Clock {
  let f = readers.get(zone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      weekday: 'short',
      hourCycle: 'h23',
    })
    readers.set(zone, f)
  }
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]))
  return {
    y: Number(p.year),
    m: Number(p.month),
    d: Number(p.day),
    h: Number(p.hour) % 24,
    mi: Number(p.minute),
    dow: DOW[p.weekday ?? 'Mon'] ?? 1,
  }
}

/** The instant this zone's clock reads `y-m-d h:mi`. Days past a month's end roll over. */
export function atClock(y: number, m: number, d: number, h: number, mi: number, zone = myZone()): Date {
  const wall = Date.UTC(y, m - 1, d, h, mi)
  const ahead = (t: number) => {
    const c = clockIn(new Date(t), zone)
    return Date.UTC(c.y, c.m - 1, c.d, c.h, c.mi) - t
  }
  let t = wall - ahead(wall)
  t = wall - ahead(t)
  return new Date(t)
}

/** `2026-11-20`, as the calendar speaks, for a day on this zone's clock. */
export const dayOf = (c: Pick<Clock, 'y' | 'm' | 'd'>): string => `${c.y}-${String(c.m).padStart(2, '0')}-${String(c.d).padStart(2, '0')}`

/**
 * The three moments offered, worked out as the server works them out for an
 * agent: three hours on to the nearest hour, nine tomorrow, nine on Monday
 * next. "Later today" is none once it would be tomorrow.
 */
export function presets(now = new Date(), zone = myZone()): { later: Date | null; tomorrow: Date; nextWeek: Date } {
  const here = clockIn(now, zone)
  const on = clockIn(new Date(now.getTime() + 3.5 * 3_600_000), zone)
  const later = atClock(on.y, on.m, on.d, on.h, 0, zone)
  return {
    later: on.d === here.d && on.m === here.m && on.y === here.y ? later : null,
    tomorrow: atClock(here.y, here.m, here.d + 1, 9, 0, zone),
    /* Monday — but never tomorrow: on a Sunday that is Tomorrow's own
       moment twice, so Next week is the Monday after. */
    nextWeek: atClock(here.y, here.m, here.d + (here.dow === 7 ? 8 : 8 - here.dow), 9, 0, zone),
  }
}

/** Whole days from today to that day, on this zone's calendar. */
export function daysFromToday(at: Date, now = new Date(), zone = myZone()): number {
  const a = clockIn(at, zone)
  const b = clockIn(now, zone)
  return Math.round((Date.UTC(a.y, a.m - 1, a.d) - Date.UTC(b.y, b.m - 1, b.d)) / 86_400_000)
}
