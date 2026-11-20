import { useEffect } from 'react'
import { useShown } from '../kit.jsx'
import { type IconName, Icon } from '../glyphs.jsx'
import { QUICK } from './triage.jsx'

/** The round face alone, for a control that brings its own button. */
export function RoundFace({ icon, on }: { icon: IconName; on: boolean }) {
  return (
    <span
      data-control
      className="relative flex size-9 items-center justify-center rounded-full"
      style={{
        background: on ? 'var(--track-on)' : 'var(--track)',
        boxShadow: on ? 'var(--control-shadow)' : undefined,
        color: on ? 'var(--ink)' : 'var(--ink-2)',
      }}
    >
      <Icon name={icon} size={16} />
    </span>
  )
}

/** A round button that opens something beside the work — the face the
    list's view has, so the two read as one kind of control. */
export function Round({
  icon,
  label,
  testId,
  on,
  onPress,
}: {
  icon: IconName
  label: string
  testId: string
  on: boolean
  onPress: () => void
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={label}
      title={label}
      aria-pressed={on}
      onClick={onPress}
      className="flex shrink-0"
    >
      <span
        data-control
        className="relative flex size-9 items-center justify-center rounded-full"
        style={{
          background: on ? 'var(--track-on)' : 'var(--track)',
          boxShadow: on ? 'var(--control-shadow)' : undefined,
          color: on ? 'var(--ink)' : 'var(--ink-2)',
        }}
      >
        <Icon name={icon} size={16} />
      </span>
    </button>
  )
}

/**
 * Beside the task, sliding in from its right — the list's view panel, the
 * same width, the same movement, a border and no ground: it stands beside
 * the work rather than over it.
 */
export function Aside({
  open,
  floating,
  onRoom,
  children,
}: {
  open: boolean
  /** In the margin beside the column, out of the flow, so the task stays put. */
  floating: boolean
  /** Told when it starts or stops taking room from the column. */
  onRoom: (taking: boolean) => void
  children: React.ReactNode
}) {
  const { there, shown, ref } = useShown(open, QUICK)
  const taking = there && !floating
  useEffect(() => onRoom(taking), [taking, onRoom])
  if (!there) return null
  return (
    <div
      ref={ref}
      data-task-aside
      data-floating={floating || undefined}
      className={`shrink-0 self-start ${floating ? 'absolute top-0' : ''}`}
      style={{
        ...(floating ? { left: 'calc(50% + 400px)' } : {}),
        /* Its room taken at once and given back once it has gone; the task
           slides to its new place from the old one (see `TaskDetail`). */
        width: 292,
      }}
    >
      {/*
        The panel arrives whole: a few pixels in from the right and faded
        up, rather than uncovered by a widening mask. Revealed by its box,
        its border and its words were cut down the middle for the whole of
        the opening — a panel being drawn rather than one arriving.
      */}
      <div
        className="ml-3 flex w-[280px] flex-col overflow-x-hidden overflow-y-auto"
        style={{
          maxHeight: 'calc(100vh - 140px)',
          borderRadius: 'var(--r-card)',
          boxShadow: 'inset 0 0 0 1px var(--line)',
          opacity: shown ? 1 : 0,
          transform: shown ? 'none' : 'translateX(12px)',
          transition: `opacity ${QUICK}ms var(--ease-out), transform ${QUICK}ms var(--ease-out)`,
        }}
      >
        {children}
      </div>
    </div>
  )
}

/**
 * One fact under the title: what it is, and the control that answers it.
 *
 * The whole chip is the control, as in the list's bar for many at once: a
 * press anywhere on it is a press on the control inside, so the menu opens
 * from where it always does, and the word beside a twenty-pixel glyph is no
 * longer dead space a hand reaches for first.
 */
export function Fact({
  icon,
  label,
  testId,
  chip = false,
  lead = false,
  snug = false,
  children,
}: {
  icon: IconName
  label: string
  testId?: string
  /** One chip in a wrapping row, as on a phone — no label column. */
  chip?: boolean
  /** The chip wears the fact's mark, for a control that has none of its
      own: a date, a sprint. */
  lead?: boolean
  /** The chip holds a pill of its own — one label — so its two sides are
      the same: the extra on the right is for a word, and here the word is
      in the inner pill. */
  snug?: boolean
  children: React.ReactNode
}) {
  if (chip)
    return (
      <span
        data-testid={testId}
        data-fact={label}
        title={label}
        onClick={pressInside}
        className={`flex h-8 max-w-full min-w-px cursor-default items-center gap-2 rounded-full ${snug ? 'px-2' : 'pr-3 pl-2'} text-base text-ink bg-track`}
      >
        {lead && <Icon name={icon} size={14} className="text-ink-3" style={{ flexShrink: 0 }} />}
        {children}
      </span>
    )
  return (
    <div className="flex h-9 min-w-px items-center gap-3">
      <span className="flex w-[96px] shrink-0 items-center gap-2 text-base text-ink-3">
        <Icon name={icon} size={16} />
        {label}
      </span>
      <span
        data-testid={testId}
        onClick={pressInside}
        className="flex h-8 min-w-px cursor-default items-center gap-2 rounded-[var(--r-row)] px-2 text-base transition-colors mouse:hover:bg-[var(--hover)] text-ink"
      >
        {children}
      </span>
    </div>
  )
}

function pressInside(e: React.MouseEvent<HTMLElement>): void {
  /* Not a press that came out of the control's own menu, or one on the
     control itself, which answers by itself. */
  if ((e.target as Element).closest('[role="menu"], [data-over], button, select, input')) return
  const control = e.currentTarget.querySelector<HTMLElement>('button, select')
  control?.click()
}
