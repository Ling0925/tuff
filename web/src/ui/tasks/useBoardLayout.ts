import { useRef, useLayoutEffect, useMemo } from 'react'
import { stopSlides, slid } from '../useDrag.js'
import { type Task } from './model.jsx'
import { type TaskData } from './useTaskData.js'
import { type BoardMoves } from './useBoardMoves.js'

/**
 * The board while something is carried: the cards close up rather than
 * jump, and the arrangement drawn is the one the drop will make.
 */
export function useBoardLayout({
  tasks,
  lists,
  byColumn,
  taken,
  carriedWith,
  drag,
  board,
}: Pick<TaskData, 'tasks' | 'lists' | 'byColumn'> & Pick<BoardMoves, 'taken' | 'carriedWith' | 'drag' | 'board'>) {
  /**
   * The board as it would be if the card were let go of now.
   *
   * Not the board plus a line drawn on it. A two-pixel line inserted into a
   * column moves every card below it by two pixels, which changes what is
   * under the pointer, which moves the line — the jitter people read as the
   * drag being broken. Showing the real arrangement instead means the gap
   * under the pointer is exactly the gap the card will leave, and nothing
   * moves when it is let go.
   */
  /*
   * The inline styles go the moment the card is let go of.
   *
   * Not when the drag ends: a drag stays alive for the hundred and seventy
   * milliseconds the flying copy takes to land, and a slide started on the
   * last pointer move before release is still running under it. Measured,
   * one card travelled seventy-nine pixels *after* the drop, over nine
   * frames, with its own `transform 160ms` still on it — the board
   * twitching once after everything had already arrived.
   *
   * Cleared at `settling` rather than at the end, so the only thing moving
   * after release is the copy flying home. The transition goes first and
   * the transform after it, in the same breath, or removing the transform
   * is itself something to animate.
   *
   * **Before the slide effect, not after it.** Both are layout effects and
   * they run in the order they are written, so with this one second there
   * was a pass in which the slide effect had already measured and the
   * stale transform was still on the card — one frame of it, at two to six
   * milliseconds, which a peak-distance measurement catches and an eye
   * does not. Declared first, the clearing happens before anything else
   * in the same commit looks at a card.
   */
  const wasDragging = useRef(false)
  useLayoutEffect(() => {
    if (drag && !drag.settling) {
      wasDragging.current = true
      return
    }
    if (!wasDragging.current) return
    wasDragging.current = false
    /*
     * Only the cards the drag set sliding — `slid` in `useDrag.ts`.
     *
     * Cancelled, not overwritten.
     *
     * Setting `transition: none` and then clearing it in the same pass
     * is not reliably a stop: the browser may collapse the two writes
     * and keep playing the slide that was already in flight, which is
     * what left a card travelling seventy-nine pixels after the drop on
     * two drops in five. Nothing *starts* an animation after the release
     * — logging every write proved that — so what is left is one that
     * began on the last pointer move and never heard it was over.
     *
     * `getAnimations` is the browser's own handle on exactly that, and
     * `finish` puts each one at its end state rather than wherever it
     * had reached: the card is already where it belongs, so its end
     * state is the truth and its middle is the thing being removed.
     */
    stopSlides()
    /* Applied now, all of them at once, so the next frame does not find a
       transition waiting to animate the transform away. */
    if (slid.size > 0) void board.current?.offsetHeight
    for (const el of slid) el.style.transition = ''
    slid.clear()
  }, [drag, board])

  /*
   * The cards close up rather than jump — FLIP.
   *
   * The hole moves between positions as the pointer does, so the cards below
   * it change place in the flex column. There is no transition on "where a
   * flex child sits", and two simpler things do not work: a height
   * transition on the hole animates nothing because the hole moves rather
   * than resizes, and a transform transition on the cards animates nothing
   * because reflow sets no transform. Both were tried and measured.
   *
   * So: remember where every card was (First), let React lay them out
   * (Last), put each one back where it came from with a transform (Invert),
   * then release them on the next frame (Play). The browser animates the
   * transform, which is compositor work and costs no layout.
   *
   * Only while something is being carried, and only on the axis a column
   * moves in. A card arriving from a fetch is a different event wearing the
   * same clothes, and it should not slide.
   *
   * **And not once it has been let go of.** A drag stays alive for the
   * hundred and seventy milliseconds the flying copy takes to land —
   * `settling` in `useDrag` — and the move is committed at the start of
   * that, not the end, because the design asks for optimistic writes. So the
   * column reorders while `drag` is still set, this effect sees cards in new
   * places, and animates them there: a slide measured at seventy-nine pixels
   * for a card that was already home. What a person sees is the board
   * twitching once after the card has landed.
   *
   * Nothing needs to slide then. The hole the card is flying into has been
   * held open the whole way down, so every other card is already where it
   * belongs — that is the whole point of showing the real arrangement during
   * the drag.
   */
  /*
   * Where each card stood, as its column's content has it — not the window.
   *
   * It was the window's `top`, and a column scrolled between two renders
   * moved every card in it by the scroll in the window's terms though none
   * of them had moved in the column. A long column carried to its foot
   * scrolls on every frame, so each time the hole moved the effect below
   * took the whole column for moving: measured on a column of 200, every
   * card in it — 197 of them — set back by the 14 to 84 pixels the column
   * had scrolled and slid home over 160ms, at every step of the gap. The
   * cards shook under the hand, the column lagged its own scroll, and each
   * card's inversion forced its own style pass, which is where the frames
   * went: long tasks of 90ms in the built app and 450 in development. That
   * is — "with many cards in a column the drag goes glitchy" —
   * and a short column never scrolls, which is why only a long one did it.
   *
   * So the scroll is added back: `top + scrollTop` is the card's place in
   * its column's content, which only a real move changes. A card that
   * changed columns is compared in the window's terms as before, because
   * two columns' contents have no common origin.
   */
  type Stood = { top: number; h: number; pane: Element | null; scroll: number }
  const were = useRef(new Map<string, Stood>())
  /** The column the gap was in at the last render, which may be closing up. */
  const lastColumn = useRef<string | null>(null)
  useLayoutEffect(() => {
    const root = board.current
    if (!root) return
    /*
     * Only the columns a card can move in.
     *
     * This read every card on the board on every render — its box, its
     * computed transform, its pane — 900 of each on the long board, and
     * the screen renders on every step of the gap. A card moves
     * only in the column the gap is in, the one it was in a step ago, and
     * the ones the carried cards come from; and before anything is picked
     * up, only a selection can make a column close up on the lift.
     */
    const involved = new Set<string>()
    if (drag) {
      if (drag.spot) involved.add(drag.spot.column)
      if (lastColumn.current) involved.add(lastColumn.current)
      for (const t of carriedWith(drag.id)) if (t.list_id) involved.add(t.list_id)
    } else if (taken.size > 1) {
      for (const t of tasks ?? []) if (taken.has(t.id) && t.list_id) involved.add(t.list_id)
    }
    lastColumn.current = drag?.spot?.column ?? null
    const cards: HTMLElement[] = []
    const panes = new Map<HTMLElement, Element | null>()
    for (const column of root.querySelectorAll<HTMLElement>('[data-list]')) {
      if (!involved.has(column.dataset.list!)) continue
      const pane = column.querySelector('[data-column-scroll]')
      for (const el of pane?.children ?? []) {
        if (!(el instanceof HTMLElement) || el.dataset.card === undefined) continue
        cards.push(el)
        panes.set(el, pane)
      }
    }
    /*
     * Measured with any running transform taken off first.
     *
     * This effect runs on every render while a drag is live, and a card
     * part-way through its own slide reports where it *looks*, not where the
     * column put it. Inverting against that compounds: measured, inverted,
     * measured again including the inversion — the transforms ran to several
     * hundred pixels and cards left the column altogether.
     *
     * Clearing the transform before reading makes the box the layout's own
     * answer, which is the only one FLIP can be built on.
     */
    const now = new Map<string, Stood>()
    /* Each pane's box on the screen, for what of a move can be seen. */
    const shown = new Map<Element, DOMRect>()
    for (const el of cards) {
      const id = el.dataset.card
      if (!id) continue
      /*
       * Measured where the layout put it, not where it looks.
       *
       * A card part-way through its own slide reports the transformed box,
       * and inverting against that compounds — transforms ran to hundreds
       * of pixels and cards left the column. So the box is read with the
       * transform discounted rather than removed: clearing it here is what
       * killed every animation, because this effect runs on each pointer
       * move and wiped the `transition` of a slide that had just started.
       * The card went none → 120 → none with no step between, which is a
       * jump wearing an animation's clothes.
       *
       * `getBoundingClientRect` includes the transform, so the layout's own
       * answer is that box minus whatever is currently translating it.
       */
      /* Only a card the board set sliding can be translated. */
      const sliding = slid.has(el) ? new DOMMatrixReadOnly(getComputedStyle(el).transform).m42 : 0
      const pane = panes.get(el) ?? null
      const box = el.getBoundingClientRect()
      now.set(id, { top: box.top - sliding, h: box.height, pane, scroll: pane?.scrollTop ?? 0 })
      if (pane && !shown.has(pane)) shown.set(pane, pane.getBoundingClientRect())
    }
    /*
     * Inverted all together, then released all together.
     *
     * Each card used to be inverted and read back on its own —
     * `offsetHeight` between the two writes, once per card — so a slide of
     * forty cards was forty style passes inside one frame. One read between
     * the two passes does the same for all of them.
     */
    const moving: [HTMLElement, number][] = []
    /*
     * And once more as a stack is let go of: the column held one place for
     * it, the rest of the stack arrives on release, and the cards below make
     * room by sliding rather than jumping. A single card needs nothing then
     * — its place was held open all the way down.
     */
    if (drag && (!drag.settling || carriedWith(drag.id).length > 1)) {
      for (const el of cards) {
        const id = el.dataset.card
        if (!id) continue
        const was = were.current.get(id)
        const is = now.get(id)
        if (was === undefined || is === undefined) continue
        const by = was.pane === is.pane ? was.top + was.scroll - (is.top + is.scroll) : was.top - is.top
        /* A pixel or two is the column settling, not a card moving. */
        if (Math.abs(by) < 2) continue
        /*
         * And only where it can be seen, coming or going.
         *
         * A gap opening in a column of 600 moves every card below it, and
         * each was given a slide: 566 cards set sliding in one step, all but
         * a dozen of them scrolled out of sight, and all 566 written to
         * twice more on release. A card off the screen at both
         * ends of its move has nothing to show; it is simply where it is.
         */
        const seen = is.pane ? shown.get(is.pane) : undefined
        const off = (top: number) => !!seen && (top > seen.bottom || top + is.h < seen.top)
        if (off(is.top) && off(is.top + by)) continue
        moving.push([el, by])
      }
      for (const [el, by] of moving) {
        slid.add(el)
        el.style.transition = 'none'
        el.style.transform = `translateY(${by}px)`
      }
      if (moving.length > 0) {
        /*
         * Released in this frame, by reading the layout back.
         *
         * It waited two animation frames, and during a drag this effect
         * runs again before they arrive: the queued release found a card
         * whose transform had already been wiped and re-inverted, so the
         * slide restarted on every pointer move and never advanced. The
         * card went from nothing to a hundred and twenty pixels and back to
         * nothing with no step in between — a jump wearing an animation's
         * clothes.
         *
         * Reading `offsetHeight` forces the style to be applied now, which
         * is what the two frames were waiting for. The transition can be
         * set immediately after, and the transform removed in the same
         * breath, because the browser has already taken the inverted
         * position as the starting point.
         */
        void root.offsetHeight
        for (const [el] of moving) {
          el.style.transition = 'transform 160ms var(--ease-out)'
          el.style.transform = ''
        }
      }
    }
    were.current = now
  })

  const arranged = useMemo(() => {
    const map = new Map<string, Task[]>()
    for (const l of lists) map.set(l.id, [...(byColumn.get(l.id) ?? [])])
    if (!drag?.spot) return map
    /*
     * Everything being carried, not only the card under the pointer.
     *
     * A selection dragged is a selection moved, so the board has to show all
     * of it leaving and all of it landing — otherwise three cards jump
     * columns on the drop, which is the one thing this screen promises not to
     * do: the arrangement under the pointer is the arrangement that will be
     * saved. `docs/specs/many-at-once.md`.
     *
     * Through `carriedWith`, which `commit` puts down in the same order.
     */
    const carried = carriedWith(drag.id)
    if (carried.length === 0) return map
    const ids = new Set(carried.map((t) => t.id))
    for (const list of map.values()) {
      for (let i = list.length - 1; i >= 0; i--) if (ids.has(list[i]!.id)) list.splice(i, 1)
    }
    /*
     * One place for the stack while it is in the air, all of them once it
     * is let go of.
     *
     * Every carried card used to be laid into the column under the pointer
     * as it went, still drawn as taken — so with three in hand the column
     * showed one gap and two blue cards that had not been put anywhere yet.
     * Now the column opens one place, the size of the card the hand is on,
     * and the rest arrive when the stack does: on release the card lands in
     * that place and the others follow it in, in the order they were taken
     * from the board.
     */
    map.get(drag.spot.column)?.splice(drag.spot.index, 0, ...(drag.settling ? carried : carried.slice(0, 1)))
    return map
  }, [byColumn, lists, drag, carriedWith])

  /** The one being carried, so the copy in flight is the same card. */
  const held = drag ? (tasks?.find((t) => t.id === drag.id) ?? null) : null
  /** How many go with it — one, unless it is part of what is taken. */
  const stack = drag ? carriedWith(drag.id).length : 0
  return { arranged, held, stack } as const
}
export type BoardLayout = ReturnType<typeof useBoardLayout>
