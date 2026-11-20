import { useEffect, useRef, useState } from 'react'
import { CLOCK, LOCALE, dayMonth } from '../data/words.js'
import { REMIND as W } from '../words/remind.js'
import { atClock, clockIn, dayOf, daysFromToday, myZone, presets } from '../data/zone.js'
import { DateButton, Fluid, Hairline, Over, inWindow } from './kit.jsx'
import { Icon } from './glyphs.jsx'

/**
 * Remind me.
 *
 * A moment of your own on a task, set from beside its due date. The face is
 * the moment written as a person says it — *Tomorrow, 9:00* — or the offer,
 * faint, when there is none. Pressed, a menu of the three moments people
 * pick most, the same calendar every date in the product opens with a time
 * beside it, and the way to take it off.
 *
 * The menu is one size from the frame it appears in: the custom date and
 * time are always there rather than opened by a row, so nothing in it grows
 * under the pointer.
 */

const MENU_W = 288
const MENU_H = 348

/** The time of day on the account's clock: `9:00`, `17:00`, or `9:00 AM` where the machine says so. */
function timeOf(at: Date): string {
  return at.toLocaleTimeString(CLOCK, { hour: 'numeric', minute: '2-digit', timeZone: myZone() })
}

/** The day as a person says it: Today, Tomorrow, a weekday this week, else the date. */
function dayWord(at: Date): string {
  const n = daysFromToday(at)
  if (n === 0) return W.today
  if (n === 1) return W.tomorrow
  const c = clockIn(at)
  const noon = new Date(c.y, c.m - 1, c.d, 12)
  if (n > 1 && n < 7) return noon.toLocaleDateString(LOCALE, { weekday: 'short' })
  return dayMonth(noon, c.y !== clockIn(new Date()).y)
}

/** `Tomorrow, 9:00` — what the chip says. */
export function writtenMoment(iso: string): string {
  const at = new Date(iso)
  return W.dayAt(dayWord(at), timeOf(at))
}

/** Whether a reminder is still to come — one the worker has sent is not shown. */
export const ahead = (r: { at: string } | null | undefined): r is { at: string } => Boolean(r && Date.parse(r.at) > Date.now())

export function RemindMe({
  value,
  said,
  onPick,
  empty = W.remindMe,
  testId = 'task-reminder',
  round = false,
}: {
  /** The moment, an ISO instant, or null for none. */
  value: string | null
  /** What it is a reminder about, for whoever cannot see it. */
  said: string
  onPick: (at: Date | null) => void
  empty?: string
  testId?: string
  /** A round button on the task's bar, beside the hours and the history,
      rather than words in its facts: the bell, lit when one is set, and the
      moment said in its title and at the head of its menu. */
  round?: boolean
}) {
  const [at, setAt] = useState<{ x: number; y: number; r: number } | null>(null)
  const self = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!at) return
    /* Heard after the calendar's, which takes Escape first and keeps it:
       one press, one thing closed. */
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setAt(null)
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [at])

  const take = (to: Date | null) => {
    setAt(null)
    onPick(to)
  }

  return (
    <>
      <button
        ref={self}
        type="button"
        data-testid={testId}
        data-at={value ?? ''}
        aria-label={value ? W.reminderSet(writtenMoment(value)) : W.remindMeAbout(said)}
        {...(round ? { title: value ? W.reminderSet(writtenMoment(value)) : W.remindMe } : {})}
        aria-haspopup="menu"
        aria-expanded={at !== null}
        onClick={(e) => {
          e.stopPropagation()
          if (at) return setAt(null)
          const box = self.current?.getBoundingClientRect()
          if (box) setAt({ x: box.left, y: box.bottom, r: box.right })
        }}
        className={round ? 'flex shrink-0' : 'flex min-w-px items-center gap-2 text-base tabular-nums'}
        style={round ? undefined : { color: value ? 'var(--ink)' : 'var(--ink-3)' }}
      >
        {round ? (
          <span
            data-control
            className="relative flex size-9 items-center justify-center rounded-full"
            style={{
              background: at ? 'var(--track-on)' : 'var(--track)',
              boxShadow: at ? 'var(--control-shadow)' : undefined,
              color: value ? 'var(--accent)' : 'var(--ink-2)',
            }}
          >
            <Icon name="bell" size={16} />
          </span>
        ) : (
          <span className="truncate">{value ? writtenMoment(value) : empty}</span>
        )}
      </button>
      {at && <Over onClose={() => setAt(null)} />}
      {at && <Menu at={at} value={value} onTake={take} />}
    </>
  )
}

function Menu({ at, value, onTake }: { at: { x: number; y: number; r: number }; value: string | null; onTake: (to: Date | null) => void }) {
  /* Worked out once, when it opens: a menu whose times move while it is
     open is a menu changing under the pointer. */
  const [offer] = useState(() => presets())
  const [day, setDay] = useState(() => dayOf(clockIn(value ? new Date(value) : offer.tomorrow)))
  const [time, setTime] = useState(() => {
    const c = clockIn(value ? new Date(value) : offer.tomorrow)
    return `${String(c.h).padStart(2, '0')}:${String(c.mi).padStart(2, '0')}`
  })
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  const [h, mi] = time.split(':').map(Number) as [number, number]
  const chosen = Number.isFinite(h) && Number.isFinite(mi) ? atClock(y, m, d, h, mi) : null
  const passed = !chosen || chosen.getTime() <= Date.now()

  const rows: { key: string; said: string; when: Date }[] = [
    ...(offer.later ? [{ key: 'later', said: W.laterToday, when: offer.later }] : []),
    { key: 'tomorrow', said: W.tomorrow, when: offer.tomorrow },
    { key: 'next-week', said: W.nextWeek, when: offer.nextWeek },
  ]
  const below = at.y + 8 + MENU_H <= window.innerHeight

  return (
    <div
      data-over
      data-remind-menu
      role="menu"
      className="fixed z-40"
      style={{
        left: inWindow(at.x, MENU_W, at.r),
        top: below ? at.y + 8 : undefined,
        bottom: below ? undefined : window.innerHeight - at.y + 28,
        width: MENU_W,
      }}
    >
      {/* The surface the task's other menus have (`kit/popover.tsx`):
          opaque, raised, with an edge. It was glass, and beside the ⋯ menu
          next to it read as a different, lighter kind of window. */}
      <div
        data-fluid
        data-menu
        className="relative overflow-hidden py-1"
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--r-card)',
          boxShadow: 'var(--card-shadow)',
        }}
      >
        <Fluid />
        {/* What is set, or that nothing is, at the head — the bar's bell
            says only that there is one. Always drawn, so the menu is one
            height either way. */}
        <div
          data-remind-now
          className="flex items-center gap-2 px-3 text-sm tabular-nums"
          style={{ height: 'var(--row-h)', color: value ? 'var(--ink)' : 'var(--ink-3)' }}
        >
          <Icon name="bell" size={14} {...(value ? { style: { color: 'var(--accent)' } } : {})} />
          <span className="min-w-px flex-1 truncate">{value ? W.reminderSet(writtenMoment(value)) : W.noReminder}</span>
        </div>
        <Hairline inset={12} />
        {rows.map((r) => (
          <button
            key={r.key}
            role="menuitem"
            data-row
            data-remind-pick={r.key}
            onClick={() => onTake(r.when)}
            className="flex w-full items-center gap-3 px-3 text-left text-base text-ink"
            style={{ height: 'var(--row-h)' }}
          >
            <span className="min-w-px flex-1 truncate">{r.said}</span>
            <span className="shrink-0 text-sm tabular-nums text-ink-3">{writtenMoment(r.when.toISOString())}</span>
          </button>
        ))}
        <Hairline inset={12} />
        {/* A day and a time of your own — the calendar the due date opens,
            and the time beside it. */}
        <div className="flex flex-col gap-2 px-3 pt-2 pb-2">
          <span className="text-sm text-ink-3">{W.pick}</span>
          <div className="flex items-center gap-2">
            <DateButton
              testId="remind-day"
              said={W.date}
              value={day}
              clearable={false}
              onPick={(to) => to && setDay(to)}
              className="flex h-8 min-w-px flex-1 items-center gap-2 rounded-[var(--r-row)] px-2 text-base tabular-nums"
              style={{ background: 'var(--track)', color: 'var(--ink)' }}
            />
            <input
              data-testid="remind-time"
              type="time"
              aria-label={W.time}
              value={time}
              onChange={(e) => e.target.value && setTime(e.target.value)}
              className="h-8 w-[104px] shrink-0 rounded-[var(--r-row)] px-2 text-base tabular-nums bg-track text-ink"
            />
          </div>
          <button
            data-testid="remind-set"
            disabled={passed}
            onClick={() => chosen && !passed && onTake(chosen)}
            className="flex h-8 items-center justify-center rounded-[var(--r-row)] text-base font-medium transition-opacity disabled:opacity-40 bg-accent text-on-accent"
          >
            {W.set}
          </button>
        </div>
        {/* Only when there is one to take off. It was drawn greyed out
            with none, to keep the menu one height; the author read a dead
            row as clutter. Taking one off closes the menu, so its height
            never changes while it is open. */}
        {value && (
          <>
            <Hairline inset={12} />
            <button
              role="menuitem"
              data-row
              data-remind-pick="remove"
              onClick={() => onTake(null)}
              className="flex w-full items-center gap-3 px-3 text-left text-base"
              style={{ height: 'var(--row-h)', color: 'var(--ink-2)' }}
            >
              <Icon name="bellOff" size={14} />
              <span className="min-w-px flex-1 truncate">{W.remove}</span>
            </button>
          </>
        )}
      </div>
    </div>
  )
}
