import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { LOCALE, HEADS } from '../../data/words.js'
import { KIT as W } from '../../words/kit.js'
import { Icon } from '../glyphs.jsx'
import { Glass } from '../Glass.jsx'
import { Over, Fluid } from './rows.jsx'
import { inWindow } from './labels.jsx'
import type { Repeat } from '@tracker/shared-schema'
import { REPEAT, repeatSaid } from '../../words/repeat.js'
import { RepeatPanel, RepeatMark, PANEL_HEIGHT, PANEL_WIDTH } from './repeat.jsx'

/**
 * How the date repeats, when the date is a task's due date.
 * `onPick` is handed the rule and, when there is
 * no date yet, the date to set with it: a rule needs a first day.
 */
export type RepeatField = {
  value: Repeat | null
  onPick: (rule: Repeat | null, due: string | null) => void
}

/**
 * A month, drawn the way the rest of this product is drawn.
 *
 * The native picker was here first and was right about one thing: a date
 * has no fixed set of answers, so the platform's own calendar knows the
 * locale, the week's first day and the keyboard for free. What it does not
 * know is this product — it arrives in the browser's chrome, in the
 * browser's colours, at the browser's size, and in a panel of controls
 * that all agree with each other it is the one thing that does not.
 *
 * So: our own month, in our own tokens, with the two shortcuts a due date
 * actually wants at the bottom. The keyboard still works — arrows walk the
 * grid, Enter takes the day under the cursor, Escape leaves — because a
 * calendar somebody can only click is worse than the native one it
 * replaced.
 */
/* Monday first, in the language the screen reads in — `M T W` in English,
   `L M M` in French. 1 January 2024 was a Monday. */
const WEEKDAYS = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i, 12).toLocaleDateString(LOCALE, { weekday: 'narrow' }))
/** `November 2026`, `novembre 2026`. */
const monthAndYear = (d: Date) => d.toLocaleDateString(LOCALE, { month: 'long', year: 'numeric' })

/** `2026-11-20`, which is what the server speaks, from a local date. */
function asDay(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** The same, back — at noon, so a timezone cannot walk it to the day before. */
function fromDay(on: string): Date {
  const [y, m, d] = on.split('-').map(Number)
  return new Date(y!, m! - 1, d!, 12)
}

/**
 * The days of one month, padded to whole weeks.
 *
 * Monday first, which is what this product's weeks are: the grid is seven
 * wide and a month that starts on a Sunday would otherwise leave six blanks
 * at the top and a short last row.
 */
function monthGrid(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month, 1, 12)
  /* `getDay` is Sunday-first, so Sunday's 0 becomes the seventh slot. */
  const lead = (first.getDay() + 6) % 7
  const days = new Date(year, month + 1, 0, 12).getDate()
  const out: (Date | null)[] = Array(lead).fill(null)
  for (let d = 1; d <= days; d++) out.push(new Date(year, month, d, 12))
  while (out.length % 7) out.push(null)
  return out
}

/**
 * The month, as a floating panel, for any date in the product.
 *
 * It was drawn only by the due date on a row; every other date — a task's
 * own due and start, a new task's, a sprint's ends, the day hours went
 * into — was the browser's own picker, a grey grid in the system's font
 * with arrows where months are and nothing of this product in it. One
 * calendar now, opened from whatever cell or field the date is in.
 */
function CalendarMenu({
  at,
  value,
  said,
  clearable = true,
  repeat,
  onTake,
  onClose,
}: {
  at: { x: number; y: number; r: number }
  value: string | null
  said: string
  /** Whether "Clear" is offered — not for a date that must have one. */
  clearable?: boolean
  /** How a due date repeats, set at the calendar's foot. */
  repeat?: RepeatField
  onTake: (on: string | null) => void
  onClose: () => void
}) {
  const today = new Date()
  const todayKey = asDay(today)

  /* Which month is on the screen, and where the cursor is in it. Opened on
     the month of the date it already has, because the commonest edit to a
     date is a small one. */
  const [shown, setShown] = useState(() => (value ? fromDay(value) : today))
  const [cursor, setCursor] = useState<string>(value ?? todayKey)

  const grid = monthGrid(shown.getFullYear(), shown.getMonth())
  /* The second panel, beside the month. */
  const [repeating, setRepeating] = useState(false)

  const take = (on: string | null) => onTake(on)

  /* Arrows walk the grid, Enter takes what is under the cursor. A calendar
     that can only be clicked is worse than the native one it replaced. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: the keys walk from the cursor; take and onClose are the opener's, read when a key is pressed
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      /* Heard first and kept: inside a dialog, Escape is the calendar's
         before it is the dialog's — one press, one thing closed. With the
         repeat panel open, that panel is the one thing. */
      if (e.key === 'Escape') {
        e.stopPropagation()
        if (repeating) return setRepeating(false)
        return onClose()
      }
      /* The panel's own buttons take Enter and Space; the grid is not
         what is being worked. */
      if (repeating) return
      const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key]
      if (step) {
        e.preventDefault()
        const to = fromDay(cursor)
        to.setDate(to.getDate() + step)
        setCursor(asDay(to))
        setShown(new Date(to.getFullYear(), to.getMonth(), 1, 12))
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        take(cursor)
      }
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [cursor, repeating])

  /* Where the month is, worked out once for both panels. Taller by the
     repeat line when it has one. */
  const tall = repeat ? 360 : 320
  const left = inWindow(at.x, 264, at.r)
  const below = at.y + 8 + tall <= window.innerHeight
  /* The repeat panel beside the month, on whichever side has room; over it
     when neither does, which is a phone. */
  const room = window.innerWidth - 8
  const side = left + 264 + 8 + PANEL_WIDTH <= room ? left + 264 + 8 : left - 8 - PANEL_WIDTH >= 8 ? left - 8 - PANEL_WIDTH : left
  const sideTop = Math.max(8, Math.min(below ? at.y + 8 : at.y - tall - 28, window.innerHeight - PANEL_HEIGHT - 8))

  /*
   * Out of whatever it was opened in, onto the page.
   *
   * Above a dialog as well as a page — a date is picked inside the new-task
   * dialog too, and at the menus' level it opened underneath it. And out of
   * it: the dialog's own transform makes it the frame `fixed` is measured
   * against, so the calendar landed 340 pixels off and was cut by the
   * dialog's edge. A portal to the body answers both.
   */
  return createPortal(
    <div className="relative z-[60]">
      <Over onClose={onClose} />
      <div
        data-over
        data-due-menu
        data-fluid
        role="dialog"
        aria-label={W.dueDateOf(said)}
        className="fixed z-40"
        style={{
          left,
          /* Above the cell when there is no room under it: a month is
               tall, and a row near the foot of a long list is where this
               is pressed most. */
          top: below ? at.y + 8 : undefined,
          bottom: below ? undefined : window.innerHeight - at.y + 28,
          width: 264,
        }}
      >
        {/* Glass, because the glass spec names floating panels among
              the places it goes — and this is the same object as the palette
              and the modal at a third size: something over the work, taking
              the keyboard, with no ground of its own but whatever it covers.
              The lens is the one in the tokens; a panel with its own
              refraction is a panel that has not decided whether it is
              chrome. */}
        <Glass radius={16} className="overflow-hidden p-2">
          <Fluid />
          {/* The month, and the way out of it either side. */}
          <div className="flex items-center justify-between px-1 pb-2">
            <button
              aria-label={W.previousMonth}
              className="flex size-8 items-center justify-center transition-colors mouse:hover:bg-[var(--hover)] text-ink-2"
              style={{ borderRadius: 'var(--r-row)' }}
              onClick={() => setShown(new Date(shown.getFullYear(), shown.getMonth() - 1, 1, 12))}
            >
              <Icon name="chevL" size={16} />
            </button>
            <span className="text-base text-ink">{monthAndYear(shown)}</span>
            <button
              aria-label={W.nextMonth}
              className="flex size-8 items-center justify-center transition-colors mouse:hover:bg-[var(--hover)] text-ink-2"
              style={{ borderRadius: 'var(--r-row)' }}
              onClick={() => setShown(new Date(shown.getFullYear(), shown.getMonth() + 1, 1, 12))}
            >
              <Icon name="chevR" size={16} />
            </button>
          </div>
          <div className="grid grid-cols-7">
            {WEEKDAYS.map((d, i) => (
              <span key={i} className="flex h-8 items-center justify-center text-sm text-ink-3">
                {d}
              </span>
            ))}
            {grid.map((d, i) => {
              if (!d) return <span key={i} className="size-8" />
              const key = asDay(d)
              const on = key === value
              const now = key === todayKey
              return (
                <button
                  key={i}
                  data-day={key}
                  aria-current={now ? 'date' : undefined}
                  aria-pressed={on}
                  onClick={() => take(key)}
                  /* No hover on the chosen day: it is already filled with
                     the accent, and a grey wash over it would say the
                     pointer had taken something back. */
                  className={`flex size-8 items-center justify-center text-base tabular-nums transition-colors ${
                    on ? '' : 'mouse:hover:bg-[var(--hover)]'
                  }`}
                  style={{
                    borderRadius: 'var(--r-row)',
                    /* The one chosen is filled, the way a toggle is: this
                       is the answer, and the rest are days it could be. */
                    background: on ? 'var(--accent)' : key === cursor ? 'var(--hover)' : undefined,
                    color: on ? 'var(--on-accent)' : 'var(--ink)',
                    /* Today is named by its weight rather than by a second
                       colour — the accent already means "this is the
                       answer", and two blues in one grid is two answers. */
                    fontWeight: now && !on ? 600 : 400,
                  }}
                >
                  {d.getDate()}
                </button>
              )
            })}
          </div>
          {/* What a due date is usually set to, and the way to take it off.
              Below a hairline, because these do something rather than
              answer the question above them. */}
          <div className="mt-2 flex items-center gap-2 border-t pt-2" style={{ borderColor: 'var(--line)' }}>
            <button
              data-due-today
              onClick={() => take(todayKey)}
              className="flex h-8 flex-1 items-center justify-center text-base transition-colors mouse:hover:bg-[var(--hover)] text-ink"
              style={{ borderRadius: 'var(--r-row)' }}
            >
              {W.today}
            </button>
            {clearable && (
              <button
                data-due-clear
                onClick={() => take(null)}
                className="flex h-8 flex-1 items-center justify-center text-base transition-colors mouse:hover:bg-[var(--hover)] text-ink-2"
                style={{ borderRadius: 'var(--r-row)' }}
              >
                {W.clear}
              </button>
            )}
          </div>
          {/* How it repeats, beside the date it repeats from. */}
          {repeat && (
            <button
              type="button"
              data-repeat-open
              aria-haspopup="dialog"
              aria-expanded={repeating}
              onClick={() => setRepeating((o) => !o)}
              className="mt-1 flex h-8 w-full items-center gap-2 px-2 text-base transition-colors mouse:hover:bg-[var(--hover)]"
              style={{ borderRadius: 'var(--r-row)', background: repeating ? 'var(--hover)' : undefined }}
            >
              <span className="flex min-w-0 flex-1 items-center gap-2" style={{ color: repeat.value ? 'var(--ink)' : 'var(--ink-2)' }}>
                {repeat.value ? (
                  <RepeatMark rule={repeat.value} />
                ) : (
                  <>
                    <Icon name="repeat" size={14} />
                    <span className="truncate">{REPEAT.repeat}</span>
                  </>
                )}
              </span>
              <Icon name="chevR" size={14} tone="quiet" />
            </button>
          )}
        </Glass>
      </div>
      {repeat && repeating && (
        <RepeatPanel
          value={repeat.value}
          anchor={value ?? todayKey}
          said={said}
          at={{ left: side, top: sideTop }}
          onPick={(rule, close) => {
            repeat.onPick(rule, value ? null : todayKey)
            if (close) onClose()
          }}
        />
      )}
    </div>,
    document.body,
  )
}

export function DuePick({
  value,
  said,
  onPick,
  disabled = false,
  /** How the date is written where this is standing. */
  format,
  /** What the cell says with no date in it. */
  empty = HEADS.none,
  /** The colour the text takes — the row decides, because only it knows
      whether a date is late. */
  tone,
  /** How it repeats — the loop in place of the calendar, the words in the
      label. */
  repeat,
}: {
  value: string | null
  /** What this is the due date of, for whoever cannot see the cell. */
  said: string
  onPick: (to: string | null) => void
  disabled?: boolean
  format: (on: string) => string
  empty?: string
  tone?: string
  repeat?: RepeatField
}) {
  const [at, setAt] = useState<{ x: number; y: number; r: number } | null>(null)
  const [warm, setWarm] = useState(false)
  const cell = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button
        ref={cell}
        data-due={value ?? ''}
        data-repeats={repeat?.value ? repeatSaid(repeat.value) : undefined}
        aria-label={repeat?.value ? `${W.dueDateOf(said)} · ${repeatSaid(repeat.value)}` : W.dueDateOf(said)}
        title={repeat?.value ? repeatSaid(repeat.value) : undefined}
        aria-haspopup="dialog"
        aria-expanded={at !== null}
        disabled={disabled}
        onClick={(e) => {
          /* The row is a link and this is a control sitting on it: a press
             that goes on opens the task instead of answering. */
          e.stopPropagation()
          if (at) return setAt(null)
          const box = cell.current?.getBoundingClientRect()
          if (box) setAt({ x: box.left, y: box.bottom, r: box.right })
        }}
        /* The whole cell, not the words in it.
        
           The button was as tall as its own text — 20 of the row's 44 —
           so the strip above and below it belonged to the row, and a press
           that missed by a few pixels opened the task instead of the
           month. A control inside a link has to take every pixel it is
           given, or the link takes the rest. */
        /*
         * The row's full height, taken without changing it.
         *
         * `h-5` left twelve pixels of row above and below the date, and a
         * press that landed there opened the task instead of the month.
         * Growing the cell fixed the hit area and made the row taller,
         * because a strip is as tall as the tallest thing in it. So the
         * control is laid out of the flow instead: it stretches past its
         * cell by the row's own padding and takes no part in the height.
         */
        /* A mouse only. A finger's `pointerenter` fires on the tap and
           never leaves, so the brightening would stay on whatever was
           pressed last. */
        onPointerEnter={(e) => e.pointerType === 'mouse' && setWarm(true)}
        onPointerLeave={() => setWarm(false)}
        className="absolute -inset-y-3 right-0 -left-2 flex items-center justify-end gap-1 pr-2 text-base whitespace-nowrap tabular-nums transition-[color,opacity]"
        /*
         * The pointer brightens the words rather than laying a ground
         * under them.
         *
         * A wash here is a box the width of the control drawn inside a row
         * that is already lit — two grounds, one inside the other, for one
         * pointer. The row says where the hand is; this says which fact it
         * is on, which is a smaller thing and wants a smaller signal.
         *
         * The colour is inline because only the row knows whether a date
         * is late, so the hover cannot be a CSS class over it: it is the
         * same decision made one step brighter.
         */
        style={{
          color: warm && !disabled ? 'var(--ink)' : tone,
          opacity: value ? 1 : warm && !disabled ? 0.8 : 0.5,
        }}
      >
        <Icon name={repeat?.value ? 'repeat' : 'cal'} size={14} />
        {value ? format(value) : empty}
      </button>
      {at && (
        <CalendarMenu
          at={at}
          value={value}
          said={said}
          {...(repeat ? { repeat } : {})}
          onTake={(on) => {
            setAt(null)
            onPick(on)
          }}
          onClose={() => setAt(null)}
        />
      )}
    </>
  )
}

/**
 * Setting it, from wherever the mark is drawn.
 *
 * The same shape as `Status`, and for the same reason: the thing that shows
 * where something stands is the thing that changes it. Fixed at the trigger
 * rather than inside it, because these marks sit in rows inside panels with
 * `overflow: hidden`, and a menu positioned in there is a menu with its
 * bottom half cut off.
 *
 * The digits are positions, not names — `1` is the first row whatever it is
 * called, which is how the list menu's digits work. `0` is the one that is
 * not a priority, and it is last in the menu and first on the keyboard
 * because taking an answer back is not a fifth answer.
 */
/**
 * A date that is a field rather than a cell — a task's own due and start, a
 * new task's, a sprint's ends, the day hours went into.
 *
 * The same calendar the row's due date opens (`CalendarMenu`); only what is
 * pressed differs, and that is drawn by whoever places it, because a date
 * in a property list, in a sprint's line and on a chip are three different
 * shapes of the same answer. `data-date` carries the value, so a test reads
 * the answer rather than the words it is written in.
 */
export function DateButton({
  value,
  onPick,
  said,
  testId,
  empty = HEADS.none,
  clearable = true,
  disabled = false,
  className,
  style,
  children,
  repeat,
}: {
  value: string | null
  onPick: (to: string | null) => void
  /** How it repeats, when this is a task's due date. */
  repeat?: RepeatField
  /** What this is the date of, for whoever cannot see it. */
  said: string
  testId?: string
  empty?: string
  clearable?: boolean
  disabled?: boolean
  className?: string
  style?: React.CSSProperties
  /** What is drawn instead of the written date, when the place wants its own. */
  children?: React.ReactNode
}) {
  const [at, setAt] = useState<{ x: number; y: number; r: number } | null>(null)
  const self = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button
        ref={self}
        type="button"
        data-testid={testId}
        data-date={value ?? ''}
        aria-label={said}
        aria-haspopup="dialog"
        aria-expanded={at !== null}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation()
          if (at) return setAt(null)
          const box = self.current?.getBoundingClientRect()
          if (box) setAt({ x: box.left, y: box.bottom, r: box.right })
        }}
        className={className ?? 'flex items-center gap-2 text-base tabular-nums'}
        style={{ color: value ? 'var(--ink)' : 'var(--ink-3)', ...style }}
      >
        {children ?? (value ? writtenDay(value) : empty)}
      </button>
      {at && (
        <CalendarMenu
          at={at}
          value={value}
          said={said}
          clearable={clearable}
          {...(repeat ? { repeat } : {})}
          onTake={(on) => {
            setAt(null)
            onPick(on)
          }}
          onClose={() => setAt(null)}
        />
      )}
    </>
  )
}

/** `16 Oct`, or `16 Oct 2025` when it is not this year. */
export function writtenDay(on: string): string {
  const d = fromDay(on)
  return d.toLocaleDateString(LOCALE, {
    day: 'numeric',
    month: 'short',
    ...(d.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }),
  })
}
