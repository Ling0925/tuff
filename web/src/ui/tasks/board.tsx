import { memo, useState, useRef, useCallback, useEffect } from 'react'
import { near } from '../TaskDetail.jsx'
import { type Task } from './model.jsx'

/**
 * A list and a board are two views of one set of rows.
 *
 * Not two tools with their own settings: the switcher changes which fields
 * are read, and nothing is stored per view, so moving between them cannot
 * lose anything.
 */
/** Where each list was left, for as long as the tab is open. */
export const LEFT_AT = { current: new Map<string, number>() }
/** And how far it could scroll when that was measured. */
export const LEFT_REACH = { current: new Map<string, number>() }

/** What a card on the board reads from the screen around it, by reference. */
export type CardFns = {
  canWrite: boolean
  setOnTask: (at: { id: string; x: number; y: number }) => void
  take: (id: string, how: 'one' | 'range', along?: { id: string }[]) => void
  byColumn: Map<string, Task[]>
  taken: Set<string>
  setTaken: (to: Set<string>) => void
  setOpen: (id: string | null) => void
  card: (t: Task, col: string) => React.ReactNode
}

/**
 * A card in its column, drawn again only when something it shows changed.
 *
 * Every card was drawn inside the screen's own render, so anything that
 * moved the screen drew all of them: a gap moving one place in a column of
 * 600 re-rendered 900 cards, and so did the drop and the server's answer to
 * it. Measured on the built app: 200 to 330 ms on picking a card up and on
 * letting it go. A card is its task, its column, whether it is
 * taken and how cards are drawn (`look`) — the same task object is the same
 * card, so a move redraws the one that moved. What it does when pressed is
 * read when it is pressed, from `fns`, so the handlers never go stale.
 */
export const BoardCard = memo(function BoardCard({
  t,
  col,
  taken,
  fns,
  slot = t.id,
}: {
  t: Task
  col: string
  taken: boolean
  /** What the drag knows it by, where one task is drawn in two columns —
      the people view's `column/task`. The task's own id everywhere else. */
  slot?: string
  /** Changes when anything a card draws changes; read by `memo`, not here. */
  look: object
  /** Its parts' count, which lives outside the task. */
  parts: string
  fns: React.RefObject<CardFns>
}) {
  return (
    <div
      onContextMenu={(e) => {
        if (!fns.current.canWrite) return
        e.preventDefault()
        fns.current.setOnTask({ id: t.id, x: e.clientX, y: e.clientY })
      }}
      data-slot={slot}
      data-card={slot}
      /* Read ahead, as a row in the list does: under the
         pointer on a desk, on the first touch on a phone. */
      onPointerEnter={() => near(t.id)}
      /*
       * The whole card opens it, the way the whole row does
       * in the list.
       *
       * The card lights end to end under the pointer and
       * then answered a press on the title alone: the id,
       * the age, the date, the face and the space around
       * them did nothing. That is a target you have to aim
       * at inside a target that looks like one, and on a
       * board the second line is half the card.
       *
       * A drag does not arrive here. Past the threshold the
       * board takes pointer capture, and the browser then
       * dispatches the click to the board rather than to
       * the card — which is also why a wobble under the
       * threshold still opens the task, as it should.
       *
       * Anything that is its own control is left alone: the
       * title is a button because it is the card's
       * accessible name and the thing a keyboard tabs onto,
       * and the keyboard's move arrows are buttons too.
       */
      onClick={(e) => {
        /* Taken rather than opened, the same two modifiers as
           in the list — and asked first, for the same reason:
           a press that waits behind "is this a control?"
           never arrives. `docs/specs/many-at-once.md`.

           A range is taken within one column. Across columns
           there is no single order to run along, and a rule
           nobody can predict is worse than no rule, so a
           shift press in another column takes just that one. */
        if (e.metaKey || e.ctrlKey) {
          e.preventDefault()
          return fns.current.take(t.id, 'one')
        }
        if (e.shiftKey) {
          e.preventDefault()
          window.getSelection()?.removeAllRanges()
          return fns.current.take(t.id, 'range', fns.current.byColumn.get(col) ?? [])
        }
        if ((e.target as Element).closest('button,a,input,select')) return
        if (fns.current.taken.size > 0) return fns.current.setTaken(new Set())
        fns.current.setOpen(t.id)
      }}
      className="group relative px-4 py-3"
      // A card separates by sitting on a lighter ground and
      // casting a little, not by having a border drawn round
      // it. In the dark theme the ground does the whole job
      // and the shadow is switched off in the theme.
      data-taken={taken ? '' : undefined}
      style={{
        background: taken ? 'color-mix(in oklch, var(--accent) 14%, var(--card))' : 'var(--card)',
        borderRadius: 'var(--r-card)',
        boxShadow: 'var(--card-shadow)',
        /* A card has a ground of its own, so a taken one is
           said with a ring as well: the tint alone reads as a
           colour somebody chose for it. */
        outline: taken ? '2px solid var(--accent)' : undefined,
        /* Inside the card's edge, all of it. Half a pixel
           out was enough for the column, which clips at its
           sides, to cut the ring off down both of them. */
        outlineOffset: taken ? '-2px' : undefined,
        /*
         * The board keeps the pan, and performs it.
         *
         * `none` was here, then taken out because it
         * refused every pan on the one element a finger
         * lands on most: a card is most of a column, so
         * the column could not be scrolled at all.
         *
         * It is back, and the missing half is back with
         * it — the hook now writes both scrollers from
         * the finger's own deltas, so refusing the
         * browser's pan costs nothing. That is the whole
         * trade, and it had to be this way round: the
         * browser commits a touch gesture to scrolling
         * when the finger lands, on the compositor, and
         * a refusal that arrives at the hold is 110
         * pixels too late and ends in `pointercancel`.
         * Measured both ways.
         *
         * Static, not set at the hold: set mid-gesture it
         * is specified to be ignored, and is.
         */
        touchAction: 'none',
        /*
         * The ordinary arrow, on a card that can be
         * dragged and opened both.
         *
         * It was `grab`, which is the hand that says
         * “take hold of this” — and a card is opened far
         * more often than it is carried, so the cursor
         * advertised the rarer of the two. `pointer`
         * would have the opposite fault and say
         * “link”. The arrow claims neither and is what
         * the rest of the board already uses; the card
         * answers a press by moving, which is the part
         * that tells you it can be moved.
         */
        cursor: 'default',
      }}
    >
      {fns.current.card(t, col)}
    </div>
  )
})

/**
 * The board's own bar along the bottom.
 *
 * The browser's cannot do this job. `scrollbar-width` is set on every pane in
 * the stylesheet, and current Chrome takes that as a signal to ignore the
 * styled pseudo-element and draw the platform's own — which on macOS is an
 * overlay that appears only *while* something is being scrolled. For a pane
 * that reads downward that is fine; for the one pane that reads sideways it
 * is a handle you can only see once you have already found the scrolling.
 *
 * And it is a handle, not only a sign. With a trackpad the board can be
 * pushed sideways; with a mouse there is nothing to push, so without this a
 * board wider than the window cannot be scrolled at all.
 *
 * Outside the scrolling box, so it does not travel with the columns. The
 * strip is there whether or not there is anything to scroll — the work does
 * not move by ten pixels the moment a project gains a list — and the pill
 * inside it is drawn only when it would mean something.
 */
export function BoardBar({ of }: { of: React.RefObject<HTMLDivElement | null> }) {
  /** Both as fractions of the whole width, so the track's size is irrelevant. */
  const [at, setAt] = useState<{ left: number; width: number } | null>(null)
  const track = useRef<HTMLDivElement>(null)
  const grab = useRef<{ x: number; left: number } | null>(null)

  const measure = useCallback(() => {
    const b = of.current
    if (!b) return
    /* A pixel of slack: a board that overflows by less than one is a rounding
       error, and a pill the full width of the track says "there is more" when
       there is not. */
    if (b.scrollWidth - b.clientWidth < 1) return setAt(null)
    setAt({ left: b.scrollLeft / b.scrollWidth, width: b.clientWidth / b.scrollWidth })
  }, [of])

  useEffect(() => {
    const b = of.current
    if (!b) return
    let frame = 0
    const soon = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    measure()
    b.addEventListener('scroll', soon, { passive: true })
    /* Two different things change what this shows: the board's own size, and
       how much is inside it. A project gaining a list is the second, and a
       resize observer on the box alone never hears about it. */
    const size = new ResizeObserver(soon)
    size.observe(b)
    const inside = new MutationObserver(soon)
    inside.observe(b, { childList: true, subtree: true })
    return () => {
      cancelAnimationFrame(frame)
      b.removeEventListener('scroll', soon)
      size.disconnect()
      inside.disconnect()
    }
  }, [measure, of])

  /*
   * Dragging it moves the board by the same fraction.
   *
   * Captured on the track, so the gesture survives the pointer leaving it —
   * a bar ten pixels tall is one the hand slides off, and a scroll that stops
   * because you drifted upward is the thing that makes people stop using it.
   */
  const onDown = (e: React.PointerEvent) => {
    const b = of.current
    const t = track.current
    if (!b || !t || !at) return
    t.setPointerCapture(e.pointerId)
    const box = t.getBoundingClientRect()
    const thumb = { left: box.left + at.left * box.width, width: at.width * box.width }
    /* Pressed beside the pill rather than on it: it comes to the pointer
       first, so one press is a jump and the drag starts from there. */
    const onThumb = e.clientX >= thumb.left && e.clientX <= thumb.left + thumb.width
    if (!onThumb) {
      b.scrollLeft = ((e.clientX - box.left - thumb.width / 2) / box.width) * b.scrollWidth
    }
    grab.current = { x: e.clientX, left: b.scrollLeft }
  }

  const onMove = (e: React.PointerEvent) => {
    const b = of.current
    const t = track.current
    const from = grab.current
    if (!b || !t || !from) return
    e.preventDefault()
    const box = t.getBoundingClientRect()
    b.scrollLeft = from.left + ((e.clientX - from.x) / box.width) * b.scrollWidth
  }

  const letGo = () => {
    grab.current = null
  }

  return (
    <div
      ref={track}
      data-board-bar
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={letGo}
      onPointerCancel={letGo}
      className="group relative mt-1 h-3 shrink-0"
      style={{ touchAction: 'none' }}
    >
      {at && (
        <div
          data-board-thumb
          className="absolute top-1/2 h-1 -translate-y-1/2 transition-colors"
          style={{
            left: `${at.left * 100}%`,
            width: `${at.width * 100}%`,
            borderRadius: 999,
            /* The same two values every other bar in the product uses, so it
               reads as one of them rather than as a decoration of its own. */
            background: 'color-mix(in oklch, var(--ink-3) 26%, transparent)',
          }}
          onPointerEnter={(e) => {
            e.currentTarget.style.background = 'color-mix(in oklch, var(--ink-3) 45%, transparent)'
          }}
          onPointerLeave={(e) => {
            if (!grab.current) {
              e.currentTarget.style.background = 'color-mix(in oklch, var(--ink-3) 26%, transparent)'
            }
          }}
        />
      )}
    </div>
  )
}

/**
 * A fade over the foot of a column that has more below.
 *
 * The board hides the browser's scrollbar — `data-own-bar`, and `theme.css`
 * says why — and a column is too narrow to be given one of its own in the
 * gutter beside it: five columns would be five strips of furniture between
 * the cards. So what a bar says here, that there is more below, is said by
 * the content going quiet at the edge instead.
 *
 * It is over the cards rather than under them, because a card has a ground
 * of its own and anything behind it is invisible. Pointer events pass
 * through: it is a thing to read, never a thing in the way of the card it
 * is drawn on.
 *
 * And it is only there when it is true. A fade at the foot of a column that
 * has nothing more below is the interface saying there is, which is worse
 * than saying nothing — so it goes the moment the last card is reached, and
 * never appears on a column short enough not to scroll.
 */
export function ColumnFade({ of }: { of: React.RefObject<HTMLDivElement | null> }) {
  const [more, setMore] = useState(false)

  useEffect(() => {
    const b = of.current
    if (!b) return
    let frame = 0
    const measure = () => {
      /* A pixel of slack, the same as the bars use: a column that overflows
         by less than one is a rounding error, not something to announce. */
      setMore(b.scrollHeight - b.clientHeight - b.scrollTop > 1)
    }
    const soon = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    measure()
    b.addEventListener('scroll', soon, { passive: true })
    /* The column's size and what is inside it both change what this says —
       a card dragged in or out is the second, which a resize observer on
       the box alone never hears. */
    const size = new ResizeObserver(soon)
    size.observe(b)
    const inside = new MutationObserver(soon)
    inside.observe(b, { childList: true, subtree: true })
    return () => {
      cancelAnimationFrame(frame)
      b.removeEventListener('scroll', soon)
      size.disconnect()
      inside.disconnect()
    }
  }, [of])

  return (
    <div
      data-column-fade
      aria-hidden
      className="pointer-events-none absolute inset-x-0 bottom-0 h-12 transition-opacity"
      style={{
        opacity: more ? 1 : 0,
        /* To the column's own ground, not to a colour of its own: the fade
           is the cards going quiet into what they are standing on. */
        background: 'linear-gradient(to top, var(--sunken), transparent)',
      }}
    />
  )
}
