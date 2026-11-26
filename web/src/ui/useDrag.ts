import { useCallback, useEffect, useRef, useState } from 'react'
import { holdUntilMoved } from './kit.jsx'

/**
 * Dragging a card on a board, the way a real thing moves.
 *
 * Pointer events rather than HTML5 drag and drop: the native one hands you a
 * ghost image, no position while the gesture is in flight, and nothing that
 * can be interrupted. A card should stay under the finger from the moment it
 * is picked up and be able to change its mind on the way.
 *
 * Three things the first version got wrong, all of which read as "the drag is
 * glitchy" and none of which are the same bug:
 *
 * 1. The card stayed in its own column while being dragged, so hit-testing
 *    found *its* column before the one the pointer was actually over — and a
 *    card carried two columns to the right landed back where it started. The
 *    copy that follows the pointer is drawn in a layer of its own now, with
 *    `pointer-events: none`, so it is invisible to hit-testing and the DOM
 *    answers honestly.
 *
 * 2. Where it would land was a two-pixel line inserted into the same column,
 *    which moved every card below it by two pixels, which changed what was
 *    under the pointer, which moved the line. The board shows the real thing
 *    instead: the card is taken out of the list and put back where it would
 *    land, so the gap under the pointer is exactly the gap it will leave.
 *
 * 3. Nothing scrolled. A board wider than the window had columns a card could
 *    not be taken to at all.
 *
 * What it tracks is the offset from where it was grabbed, never the card's
 * centre. Snapping to the middle on pick-up is the single thing that breaks
 * the illusion fastest — the card jumps out from under you before it has
 * moved anywhere.
 */

/** Enough movement to mean a drag and not a click with a shaky hand. */
const THRESHOLD = 6
/** How near an edge the pointer comes before that edge starts scrolling. */
const EDGE = 64
/**
 * And never more than this share of the scroller.
 *
 * 64 was written for a mouse against a full-height column. A phone's
 * column is 408 tall, so two zones came to 128 of it against 280 of
 * middle — a third of the column given to a behaviour meant for its
 * edges. A share leaves half of any scroller as a middle, at any size.
 */
const EDGE_SHARE = 0.25
/** The fastest an edge scroll runs, in pixels a frame. */
const SPEED = 16
/**
 * A finger gets a third of the pointer's.
 *
 * A mouse is led deliberately and watched; a thumb rests where the hand
 * can reach, and the pointer's speed under it reads as the board bolting
 * rather than as the edge offering more room.
 */
const SPEED_TOUCH = 5

/**
 * On a touch screen the board owns the whole gesture, the pan included.
 *
 * This is the one thing every earlier attempt had backwards. They all left
 * the pan to the browser and tried to take it away at the hold, and the
 * browser will not give it back: it decides what a gesture is when the
 * finger lands, on the compositor, before any hold can have fired.
 *
 * Measured from the other side, which is what settled it. `preventDefault`
 * on a cancelable `touchmove` and nothing else changed: the touchmove does
 * arrive, it is cancelable, the refusal does land — `defaultPrevented` reads
 * true — and the column still travelled 110 pixels and the gesture still
 * ended in `pointercancel`. No script wrote `scrollTop` at all; the setter
 * was instrumented and counted zero writes. The scroll is the compositor's,
 * and the refusal reaches the main thread after it has already happened.
 *
 * So `touch-action: none` goes on the card *statically*, before any finger
 * lands, and the two pans become ours to write. That is the trade the spec's
 * table never tried: every row in it either set the property mid-gesture,
 * where it is specified to be ignored, or left the pan native and tried to
 * refuse it afterwards.
 *
 * It goes on the card's whole subtree, not the card: `touch-action` is not
 * inherited, and the title is a button, so `none` on the card alone left
 * `auto` under most of what a thumb lands on. `theme.css` carries it.
 *
 * What it costs is the twenty lines below. What it buys is a gesture decided
 * by us instead of guessed at: 210 pixels of column travel and 225 of board
 * travel before the hold, which is parity with the native scrolling it
 * replaces, and after the hold zero drift, every move delivered, no cancel.
 *
 * One detail that is not obvious and is load-bearing. The carry is driven by
 * `pointermove`, never by `touchmove`. Once a `touchmove` has been refused,
 * further `touchmove`s stop arriving — measured, one delivered of six —
 * while `pointermove` keeps flowing for the whole gesture, all six. So
 * `touchmove` decides the gesture and refuses the default, and `pointermove`
 * is what actually carries the card.
 */

/** Which way a finger committed before the hold could fire. */
type Pan = 'undecided' | 'down' | 'across' | 'carry'

/** A place on the board: which column, and how far down the cards already there. */
export type Spot = { column: string; index: number }

export type Drag = {
  id: string
  /** The pointer now, in the viewport's terms. */
  x: number
  y: number
  /** Where inside the card it was taken hold of, so it stays under that point. */
  grabX: number
  grabY: number
  /** What size it was, so the copy is the same card and not a smaller one. */
  w: number
  h: number
  /** Where it would land if let go of now. */
  spot: Spot | null
  /** True once it has been let go of and is settling into place. */
  settling: boolean
  /** Carried by a finger, which gets a gentler edge than a pointer does. */
  touch: boolean
}

const reduced = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** Faster the closer to the edge, and nothing at all outside it. */
/**
 * How a thrown column comes to rest.
 *
 * The pan is ours, which means the glide after the finger leaves is ours
 * too — and it was missing entirely. Measured: tracking exactly 1:1 for
 * 200 pixels of finger, then 0 pixels of travel after release. A native
 * scroll keeps going and settles; this one stopped dead on the frame the
 * finger lifted, which is what reads as a column being heavy and slow
 * even though it never lagged by a pixel.
 *
 * 0.95 a frame comes to rest in about a third of a second from a brisk
 * flick, which is close to what the platform does. Below a tenth of a
 * pixel a frame there is nothing left to see, so it stops rather than
 * approaching zero forever.
 */
const DECAY = 0.95
const STILL = 0.1

const edge = (extent: number): number => Math.min(EDGE, extent * EDGE_SHARE)

const ramp = (distance: number, extent: number, speed: number): number => {
  const zone = edge(extent)
  /*
   * Clamped at the near end, not just the far one.
   *
   * `Math.max(0, …)` guarded against a pointer outside the zone and left
   * the other side open: a finger carried *past* the edge gives a negative
   * distance, `(zone - distance) / zone` goes above 1, and the old
   * `Math.min(1, …)` capped it — but only after `Math.max(0, …)` had
   * already been applied to the wrong operand order, so beyond the board
   * the ramp read zero and the board stopped scrolling at the one moment
   * more board was being asked for.
   *
   * Measured on a phone: a card carried to the right edge, where the next
   * column is entirely off screen, scrolled the board 0 pixels — so there
   * was nowhere to drop it and it went back. Past the edge is the
   * strongest possible ask, so it saturates rather than vanishing.
   */
  const reach = Math.min(1, Math.max(0, (zone - distance) / zone))
  return Math.round(speed * (distance < 0 ? 1 : reach))
}

/**
 * The column at a point on the board, read from the columns' boxes.
 *
 * It was a hit test — `elementsFromPoint`, then the first answer inside a
 * column — and a hit test walks every box under the board's layer, so its
 * cost grows with the cards. On a column of 600 it measured six
 * milliseconds a call, asked twice a frame while a card is carried, which
 * on its own is most of a frame. The columns stand side by side and there
 * are a handful of them, so their boxes answer the same question in
 * microseconds: the one that holds the point, inside what the board
 * shows (a column scrolled out of it is under something else).
 */
export function columnAt(root: HTMLElement | null, x: number, y: number): HTMLElement | null {
  if (!root) return null
  const shown = root.getBoundingClientRect()
  if (x < shown.left || x >= shown.right || y < shown.top || y >= shown.bottom) return null
  for (const column of root.querySelectorAll<HTMLElement>('[data-list]')) {
    const r = column.getBoundingClientRect()
    if (x >= r.left && x < r.right && y >= r.top && y < r.bottom) return column
  }
  return null
}

/**
 * The cards the board has set sliding during this drag.
 *
 * Stopping the slides on release asked every card on the board for its
 * animations, twice — once here and once in the board's own clean-up —
 * and `getAnimations` brings each card's style up to date to answer. On a
 * board of 900 cards that was the 90 to 210 ms frame the release froze on,
 * with the copy's flight home lost inside it. Only a card the
 * board inverted can be sliding, so the board writes down which, and only
 * those are asked.
 */
export const slid = new Set<HTMLElement>()

/** Every slide put at its end, where the card already belongs. */
export function stopSlides(): void {
  for (const el of slid) {
    for (const a of el.getAnimations()) a.finish()
    el.style.transition = 'none'
    el.style.transform = ''
  }
}

export function useBoardDrag({
  enabled,
  resolve,
  onDrop,
}: {
  enabled: boolean
  /** Where the pointer is pointing, in the board's terms. */
  /**
   * Where the pointer is, and where the card it is carrying actually sits.
   *
   * `mid` is the card's own vertical middle. The pointer alone is not
   * enough: a card is held wherever it was grabbed, so a pointer 20 pixels
   * below a card's top is 50 pixels above its middle, and a threshold read
   * from the pointer is off by the grab offset in whichever direction the
   * hand happened to take hold.
   *
   * `h` is its height, so the board can find its two edges: which way it
   * goes past a neighbour is decided by the edge that is leading.
   */
  resolve: (x: number, y: number, id: string, mid: number, h: number) => Spot | null
  onDrop: (id: string, spot: Spot) => void
}) {
  const [drag, setDrag] = useState<Drag | null>(null)
  /** The same thing a frame earlier, for the loops that cannot wait for React. */
  const live = useRef<Drag | null>(null)
  const from = useRef<{ id: string; x: number; y: number; rect: DOMRect; pointer: number } | null>(null)
  /*
   * A finger has to hold still before it can carry anything.
   *
   * On a mouse the six-pixel threshold below separates a click from a
   * drag. On a touch screen it separates nothing — a scroll *is* that
   * movement — so every attempt to read a column picked a card up, and
   * the board could not be used with a thumb. Refusing the finger
   * outright fixed that and took the gesture away with it.
   *
   * So: press and wait. The timer is what makes a drag out of a touch,
   * and any movement before it fires is a scroll and cancels it. This
   * is the long press the sidebar's spec said would be needed and was
   * not built there.
   */
  /** A glide in flight, so the next finger down stops it. */
  const thrown = useRef(0)
  const held = useRef<number | null>(null)
  const ready = useRef(false)
  /* The finger's own gesture: which way it went, and what the two scrollers
     stood at when it landed, so the pan is an offset from the start rather
     than a sum of deltas — deltas added up over coalesced moves drift. */
  const pan = useRef<{
    mode: Pan
    x: number
    y: number
    top: number
    left: number
    column: HTMLElement | null
    /* The last couple of moves, for the throw. A single pair of points is
       the velocity of one frame, which a finger slowing down at the end
       reads as a stop and a finger flicking reads as whatever the last
       two milliseconds happened to be. */
    was: { t: number; x: number; y: number }[]
  } | null>(null)
  const board = useRef<HTMLDivElement | null>(null)
  const layer = useRef<HTMLDivElement | null>(null)
  const fns = useRef({ resolve, onDrop })
  fns.current = { resolve, onDrop }

  const put = useCallback((d: Drag | null) => {
    const was = live.current
    live.current = d
    /*
     * A move that changes only where the copy is drawn moves the copy, and
     * nothing else.
     *
     * Every pointer move was a new state, so the whole board was drawn
     * again on every move to shift one absolutely placed box — on a column
     * of 600 that was most of each frame before a gap had moved at all.
     * The copy's place is written to it directly; the board
     * hears only what changes the board: which card, where it would land,
     * whether it is settling. A render for another reason still draws the
     * copy where it is: React compares against what it drew last, finds
     * the same numbers, and leaves the box alone.
     */
    const node = layer.current
    if (
      d &&
      was &&
      node &&
      d.id === was.id &&
      d.settling === was.settling &&
      d.touch === was.touch &&
      d.spot?.column === was.spot?.column &&
      d.spot?.index === was.spot?.index
    ) {
      node.style.left = `${d.x - d.grabX}px`
      node.style.top = `${d.y - d.grabY}px`
      return
    }
    setDrag(d)
  }, [])

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // A secondary button is a context menu, not a drag.
      if (!enabled || e.button !== 0) return
      const target = e.target as HTMLElement
      /*
       * Text entry never starts a drag, and neither does anything that opts
       * out. Not "any button": the card's title is a button, because pressing
       * it opens the task — and refusing to drag from it meant refusing to
       * drag from most of the card.
       */
      const control = !!target.closest('input, select, textarea, [data-no-drag]')
      if (control && e.pointerType === 'mouse') return
      const card = target.closest('[data-card]') as HTMLElement | null
      if (!card) return
      /*
       * A finger on a card's own control still scrolls the column.
       *
       * The face, the priority and the cycle are controls inside the card,
       * so they sit under `touch-action: none` with the rest of it and the
       * browser will not pan from them. Returning here left the pan nobody's:
       * measured on an iPhone, a swipe starting on the face moved the column
       * 0 pixels against 250 from the title beside it, and the chip row is
       * where a thumb reading down a column lands as often as anywhere.
       *
       * So a finger there gets the pan and never the hold: a control is
       * pressed, not carried, and a tap that does not travel still reaches
       * it, because nothing below is refused until the finger has moved.
       */
      if (control) {
        if (thrown.current) {
          cancelAnimationFrame(thrown.current)
          thrown.current = 0
        }
        from.current = null
        ready.current = false
        pan.current = {
          mode: 'undecided',
          x: e.clientX,
          y: e.clientY,
          top: (card.closest('[data-column-scroll]') as HTMLElement | null)?.scrollTop ?? 0,
          left: board.current?.scrollLeft ?? 0,
          column: card.closest('[data-column-scroll]') as HTMLElement | null,
          was: [{ t: e.timeStamp, x: e.clientX, y: e.clientY }],
        }
        return
      }
      from.current = {
        id: card.dataset.card!,
        x: e.clientX,
        y: e.clientY,
        rect: card.getBoundingClientRect(),
        pointer: e.pointerId,
      }
      /*
       * A mouse is ready at once; a finger has to hold.
       *
       * 320ms: past a tap, short of the delay that reads as the gesture
       * not working. The card answers when it fires — the little jump
       * is the whole feedback, and without it nobody knows the hold
       * worked until they move.
       */
      /* A finger landing on a column that is still gliding stops it, the
         way catching a spinning thing stops it. Without this the next
         pan fights the throw for the same scroller. */
      if (thrown.current) {
        cancelAnimationFrame(thrown.current)
        thrown.current = 0
      }
      ready.current = e.pointerType === 'mouse'
      if (!ready.current) {
        /* A finger: remember where the two scrollers stood, because from
           here on the pan is ours to perform. */
        const column = card.closest('[data-column-scroll]') as HTMLElement | null
        pan.current = {
          mode: 'undecided',
          x: e.clientX,
          y: e.clientY,
          top: column?.scrollTop ?? 0,
          left: board.current?.scrollLeft ?? 0,
          column,
          was: [{ t: e.timeStamp, x: e.clientX, y: e.clientY }],
        }
        held.current = window.setTimeout(() => {
          ready.current = true
          held.current = null
          /* The hold won. Nothing else may claim this gesture now. */
          if (pan.current) pan.current.mode = 'carry'
          if (navigator.vibrate) navigator.vibrate(8)
          /*
           * And the card comes away now, under a still finger.
           *
           * It used to wait for the first move, which left the hold
           * answering with a buzz and nothing else — easy to miss on a
           * phone, and easy to doubt. For the whole of that wait the
           * board looked exactly as it had before the press, so the only
           * way to find out whether the mode was on was to drag and see.
           *
           * Lifting it here means the tint, the ring and the lift arrive
           * with the buzz: the press is answered by the thing the press
           * was about.
           */
          const c = from.current
          if (c) {
            put({
              id: c.id,
              x: c.x,
              y: c.y,
              grabX: c.x - c.rect.left,
              grabY: c.y - c.rect.top,
              w: c.rect.width,
              h: c.rect.height,
              spot: fns.current.resolve(c.x, c.y, c.id, c.y - (c.y - c.rect.top) + c.rect.height / 2, c.rect.height),
              settling: false,
              touch: true,
            })
          }
        }, 320)
      }
    },
    [enabled, put],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const o = from.current
      if (!o) return
      if (!live.current) {
        // Below the threshold nothing has happened yet, so a click still
        // reaches whatever is under it.
        if (Math.hypot(e.clientX - o.x, e.clientY - o.y) < THRESHOLD) return
        /*
         * A finger that moves before the hold fires was scrolling.
         *
         * This is the whole of telling the two gestures apart: the hold
         * says "carry this" and any travel before it says "I am reading
         * the column". Letting go of the press here hands the gesture
         * back to the browser, which still has the pan — nothing was
         * captured and no default was prevented.
         */
        if (!ready.current) {
          if (held.current !== null) {
            clearTimeout(held.current)
            held.current = null
          }
          from.current = null
          return
        }
        /*
         * Captured on the board, not on the card.
         *
         * Capture has to be taken by something that survives the whole
         * gesture, and the card does not: it is rendered somewhere else the
         * moment it starts moving, which in React means a different DOM node
         * and a capture silently dropped. The board is the one element that
         * is in the same place at the end as at the start.
         *
         * Taken here rather than on the press, too: with capture held from
         * pointerdown the browser retargets the click, and every button
         * inside a card stops working with nothing thrown.
         */
        board.current?.setPointerCapture(o.pointer)
      }
      const spot = fns.current.resolve(e.clientX, e.clientY, o.id, e.clientY - (o.y - o.rect.top) + o.rect.height / 2, o.rect.height)
      put({
        id: o.id,
        x: e.clientX,
        y: e.clientY,
        grabX: o.x - o.rect.left,
        grabY: o.y - o.rect.top,
        w: o.rect.width,
        h: o.rect.height,
        // Over a gap between columns the answer is nothing, and nothing is
        // not the same as "back where you started": the last place it could
        // have landed stays shown until there is a better one.
        spot: spot ?? live.current?.spot ?? null,
        settling: false,
        /* `pan` exists only for a finger — it is what performs the pan a
           mouse never needs — so its presence is the answer. */
        touch: !!pan.current,
      })
    },
    [put],
  )

  /** Let go of, or given up on. */
  const finish = useCallback(
    (commit: boolean, at = performance.now()) => {
      const d = live.current
      from.current = null
      /* The hold goes with the gesture, or a tap that never became a drag
         leaves a timer behind to fire under the next one. */
      if (held.current !== null) {
        clearTimeout(held.current)
        held.current = null
      }
      ready.current = false
      /*
       * A pan let go of keeps going.
       *
       * Only a pan: a carried card is placed, not thrown, and the board
       * under it is already arranged the way the drop arranged it.
       *
       * The speed comes from the last few moves rather than the final
       * pair, because a finger slowing to a stop ends with two points a
       * millisecond apart and would read as a flick, and a finger
       * flicking ends with whatever one frame happened to catch.
       */
      const g = pan.current
      /*
       * Let go of here, before the throw is weighed, and not after it.
       *
       * The two `return`s below leave `finish` for a pan that ends without
       * a throw — a finger that stopped before it lifted, which is how most
       * reading ends — and the pan was cleared under them. So it outlived
       * its gesture, and the window's `touchmove` went on taking every
       * finger that came next: anything that did not start on a card (a
       * gap, a card's face, the empty foot of a column) was refused to the
       * browser and spent putting the *previous* column back where that
       * gesture had started it. Measured in the phone the tests run: a
       * sideways swipe after a slow one down moved the board 0 pixels.
       */
      pan.current = null
      if (g && (g.mode === 'down' || g.mode === 'across')) {
        const first = g.was[0]
        const last = g.was[g.was.length - 1]
        const ms = first && last ? last.t - first.t : 0
        const down = g.mode === 'down'
        const node = down ? g.column : board.current
        /* Under 16ms is a single frame's worth of samples, and dividing by
           it turns noise into a throw. */
        if (node && first && last && ms > 16) {
          let v = ((down ? last.y - first.y : last.x - first.x) / ms) * 16
          /*
           * And a finger that stopped before it left throws nothing.
           *
           * The window above keeps the throw honest about *speed* and
           * cannot keep it honest about *now*: a drag that ends in a
           * pause still has the drag inside the window, and the glide
           * carried on from a hand that was no longer moving.
           *
           * What says “now” is the gap between the last move and the
           * release. A finger lifting mid-flick leaves within a frame or
           * two of its last move; one that came to rest and then lifted
           * leaves a hole. 70ms is the same window, read from the other
           * end.
           *
           * The threshold is read from the gesture rather than fixed,
           * because the gap between moves is the platform's to choose: a
           * real finger is sampled every 8 to 16ms, a synthetic one
           * every 40 to 55, and a fixed 70 threw away a perfectly
           * ordinary scroll in the test while letting everything through
           * on a phone. Three times the gesture's own spacing is “one
           * missed sample” at any rate, with a floor so that a very fast
           * gesture does not set an impossibly tight one.
           *
           * This is the one part measured on the device and not here: a
           * synthetic `touchmove` carrying the same coordinates as the
           * one before it is dropped by the browser — 7 sent, 3
           * delivered — so a held-still finger cannot be expressed
           * through CDP at all. A real one trembles and keeps sending.
           */
          const spacing = Math.max(50, (ms / Math.max(1, g.was.length - 1)) * 3)
          if (at - last.t > spacing) return
          /*
           * A throw has to be fast, not merely recent.
           *
           * The first guard here was on elapsed time — “under 120ms or it
           * is a finger that has stopped” — and it was tuned against a
           * synthetic touch, which delivers moves 42 to 51ms apart where a
           * real finger is nearer 8. It threw out every gesture on the
           * device it was measured on and would have thrown out none on a
           * phone. Measuring the thing itself is the fix: a finger that
           * has stopped is slow whatever the sampling rate, and 0.4
           * pixels a frame is slower than anything anybody means as a
           * flick.
           *
           * Measured with it: 314 pixels of glide from a flick, 0 from a
           * drag that ended standing still.
           */
          if (Math.abs(v) < 0.4) return
          const glide = () => {
            v *= DECAY
            if (Math.abs(v) < STILL) return
            const was = down ? node.scrollTop : node.scrollLeft
            if (down) node.scrollTop = was - v
            else node.scrollLeft = was - v
            /* Hit an end and there is nothing left to coast through —
               carrying on would spin a frame loop against a clamp. */
            if ((down ? node.scrollTop : node.scrollLeft) === was) return
            thrown.current = requestAnimationFrame(glide)
          }
          thrown.current = requestAnimationFrame(glide)
        }
      }
      /*
       * The travelling highlight waits for a hand that has moved.
       *
       * A card dropped under a stationary cursor is not a card the hand
       * pointed at. The column rebuilds around it, `Fluid` re-asks what
       * is under the pointer's last known place — which is how a
       * highlight survives a re-render — and the card arrives already
       * lit, with nothing having been hovered.
       */
      holdUntilMoved()
      // Let go of twice — a pointerup and a cancel for the same gesture —
      // would commit the move twice. The second one has nothing to do.
      if (!d || d.settling) return
      /*
       * Settling is said first, and the move made after it.
       *
       * The design asks for writes to be optimistic, and settling is a
       * cosmetic flight of a copy that is already redundant — the real card
       * is in its new place underneath before the copy arrives. Waiting for
       * the animation to commit would make the board slower than the
       * server, so the commit still happens here and not at the end.
       *
       * What changed is the order of the two, and it is not cosmetic. The
       * move reorders the board's own rows and the flag lives in this hook;
       * React batches both, but the board's slide effect reads the flag to
       * know that a drop is not a drag. Told the other way round there was
       * a render carrying the new arrangement and `settling: false`, and
       * the effect did what it is for — animated every card into a place
       * it was already in. Seventy-nine pixels, after the card had landed,
       * on two drops in five.
       *
       * Setting the flag first means no render can show the new order
       * without also knowing why it changed.
       */
      /*
       * The slides are stopped here, in the event, before anything renders.
       *
       * Clearing them in a layout effect is already too late: between the
       * pointer going up and React committing there is a frame the browser
       * paints on its own, and a slide started on the last pointer move is
       * still running in it. Measured, one frame at two to six
       * milliseconds carrying up to 135 pixels of travel — invisible as
       * motion and plainly there in a per-frame reading. Reordering the
       * effects did not move it, because the frame happens before either
       * of them.
       *
       * `getAnimations().finish()` puts each one at its end state, which
       * is where the card already belongs: the board has been showing the
       * real arrangement the whole way down, so the end of a slide is the
       * truth and its middle is the only part being thrown away.
       */
      stopSlides()
      put({ ...d, settling: true, ...(commit ? {} : { spot: null }) })
      if (commit && d.spot) fns.current.onDrop(d.id, d.spot)
    },
    [put],
  )

  /* The event's own clock, which is the same one `touchmove` stamps with
     — `performance.now()` read a tick later is close enough but not the
     same number, and this is a 70ms judgement. */
  const onPointerUp = useCallback((e: React.PointerEvent) => finish(true, e.timeStamp), [finish])
  const onPointerCancel = useCallback((e: React.PointerEvent) => finish(false, e.timeStamp), [finish])

  /*
   * The last hundred and seventy milliseconds.
   *
   * A card that stops dead where the finger left it and reappears somewhere
   * else has no relationship to the place it went. The copy flies to the slot
   * the board is already holding open for it, which is the same slot the
   * person was shown the whole way down.
   */
  const settling = drag?.settling ?? false
  const id = drag?.id
  useEffect(() => {
    if (!settling || !id) return
    let done = false
    const stop = () => {
      if (done) return
      done = true
      put(null)
    }
    const frame = requestAnimationFrame(() => {
      const node = layer.current
      const slot = document.querySelector(`[data-slot="${id}"]`)
      if (!node || !(slot instanceof HTMLElement) || reduced()) return stop()
      const to = slot.getBoundingClientRect()
      const at = node.getBoundingClientRect()
      const move = node.animate(
        [{ transform: 'translate(0px, 0px)' }, { transform: `translate(${to.left - at.left}px, ${to.top - at.top}px)` }],
        { duration: 170, easing: 'cubic-bezier(0.23, 1, 0.32, 1)', fill: 'forwards' },
      )
      /*
       * And set down to its own size on the way, in the same movement.
       *
       * The copy is lifted to 102% while in hand, and it stayed lifted all
       * the way home: it landed on the card two per cent larger round the
       * point it was held by, and when it went the card under it was
       * smaller — the far corner, where the face is, jumped three pixels in
       * one frame. Measured at the face: the copy's at 1035, the card's at
       * 1032. Brought to 1 on the same curve, the copy is the card when it
       * goes.
       */
      /*
       * And to the width of where it lands, when that is not the width it
       * left: on the board of members a column goes when its last open card
       * is carried out of it, and the columns beside it widen in the same
       * frame — the copy, still the old width, landed with its corner face
       * forty pixels short of the card's, and the face jumped when it went.
       * Width rather than a transform, which would squeeze the letters; one
       * small element, for the flight, and only when the two differ.
       */
      if (Math.abs(to.width - at.width) >= 1)
        node.animate([{ width: `${at.width}px` }, { width: `${to.width}px` }], {
          duration: 170,
          easing: 'cubic-bezier(0.23, 1, 0.32, 1)',
          fill: 'forwards',
        })
      const lifted = node.querySelector<HTMLElement>('[data-lift]')
      lifted?.animate([{ transform: 'scale(1.02)' }, { transform: 'scale(1)' }], {
        duration: 170,
        easing: 'cubic-bezier(0.23, 1, 0.32, 1)',
        fill: 'forwards',
      })
      move.onfinish = stop
      move.oncancel = stop
    })
    return () => {
      cancelAnimationFrame(frame)
      stop()
    }
  }, [settling, id, put])

  /*
   * The board scrolls itself when a card is carried to its edge.
   *
   * Without it, a column off the side of the window is a column a card cannot
   * reach — the gesture has no way to ask for more board. The spot is worked
   * out again on every frame, because the content moves while the pointer
   * stands still.
   */
  useEffect(() => {
    if (!id || settling) return
    let frame = 0
    let asked = ''
    const step = () => {
      const d = live.current
      /*
       * Nothing to work out once it has been let go of.
       *
       * This effect is torn down when settling begins, but a frame already
       * queued still runs — and it read the pointer, worked out a place from
       * a board that had just been rearranged by the drop, and wrote it back
       * over the state that was settling. The gap jumped one slot at the
       * exact moment the card was landing in it.
       */
      if (d && !d.settling) {
        const b = board.current
        if (b) {
          const r = b.getBoundingClientRect()
          const z = edge(r.width)
          const speed = d.touch ? SPEED_TOUCH : SPEED
          if (d.x - r.left < z) b.scrollLeft -= ramp(d.x - r.left, r.width, speed)
          else if (r.right - d.x < z) b.scrollLeft += ramp(r.right - d.x, r.width, speed)
        }
        /*
         * The column is found first, and its pane asked of it — not the
         * pane found under the finger.
         *
         * A pane does not reach the top of its column: the heading sits
         * above it, outside the scrolling box. So at the very place the
         * edge scroll exists for, the point is over the heading and
         * `elementsFromPoint` answers with the column but never the pane,
         * and the scroll that should have fired fired not at all.
         * Measured: eleven writes while the finger moved, zero while it
         * sat twenty pixels from the top asking for more column.
         *
         * Asking the column for its pane is the same answer everywhere in
         * the column, heading included.
         */
        const scroller = columnAt(board.current, d.x, d.y)?.querySelector('[data-column-scroll]')
        if (scroller instanceof HTMLElement) {
          /* Against the pane's own box, which is where the cards are, and
             not the column's — they differ by the heading, and a zone
             measured against the wrong one is offset by its height. */
          const r = scroller.getBoundingClientRect()
          const z = edge(r.height)
          const speed = d.touch ? SPEED_TOUCH : SPEED
          if (d.y - r.top < z) scroller.scrollTop -= ramp(d.y - r.top, r.height, speed)
          else if (r.bottom - d.y < z) scroller.scrollTop += ramp(r.bottom - d.y, r.height, speed)
        }
        /*
         * Asked again only when something under the card has moved: the
         * pointer, or either scroller. Asked on every frame, a card held
         * still over a column of 600 measured that column sixty times a
         * second for the same answer.
         */
        const now = `${d.x},${d.y},${board.current?.scrollLeft},${scroller instanceof HTMLElement ? scroller.scrollTop : ''}`
        if (now !== asked) {
          asked = now
          const spot = fns.current.resolve(d.x, d.y, d.id, d.y - d.grabY + d.h / 2, d.h)
          if (spot && (spot.column !== d.spot?.column || spot.index !== d.spot?.index)) {
            put({ ...d, spot })
          }
        }
      }
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [id, settling, put])

  /*
   * The finger's gesture, which the board now owns outright.
   *
   * `touch-action: none` on the card means the browser will not pan for us,
   * so this does it: the first travel past the threshold picks an axis, and
   * every move after that writes the one scroller that axis belongs to. The
   * offset is taken from where the scroller stood when the finger landed, so
   * a coalesced move cannot accumulate error.
   *
   * Once the hold has fired the mode is `carry` and there is nothing to pan:
   * the move is refused and `pointermove` carries the card.
   *
   * Non-passive, and on the window rather than the card: React's
   * `onTouchMove` is registered passive and cannot refuse anything, and a
   * listener on the card goes with the node the moment the card re-renders
   * somewhere else.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: one listener for the life of the board; put reads refs
  useEffect(() => {
    const touch = (e: TouchEvent) => {
      const g = pan.current
      const t = e.touches[0]
      if (!g || e.touches.length !== 1 || !t) return
      const dx = t.clientX - g.x
      const dy = t.clientY - g.y
      if (g.mode === 'undecided') {
        if (Math.hypot(dx, dy) < THRESHOLD) return
        /* Whichever way it went further is the way it meant. The hold is
           off: a finger that travelled was reading, not carrying. */
        g.mode = Math.abs(dx) > Math.abs(dy) ? 'across' : 'down'
        if (held.current !== null) {
          clearTimeout(held.current)
          held.current = null
        }
      }
      /*
       * The last 70ms of the gesture, not the last four moves of it.
       *
       * Four samples sounds like “recent” and is not: a finger that
       * drags, stops dead and lifts leaves four points, the oldest of
       * which still has the drag in it, so the average across them threw
       * a column 357 pixels while the finger had been standing still —
       * measured, and the worst version of this bug, because the hand
       * was not moving at all.
       *
       * A window in milliseconds says what was meant. 70 is about four
       * frames on a phone and a dozen synthetic moves in a test, and a
       * finger held still for longer than that has an empty window and
       * no throw, whatever the sampling rate.
       */
      g.was.push({ t: e.timeStamp, x: t.clientX, y: t.clientY })
      while (g.was.length > 2 && e.timeStamp - (g.was[0]?.t ?? 0) > 70) g.was.shift()
      if (g.mode === 'down' && g.column) g.column.scrollTop = g.top - dy
      else if (g.mode === 'across' && board.current) board.current.scrollLeft = g.left - dx
      else if (g.mode === 'carry') {
        /*
         * The carry is driven from here, because `pointermove` lies.
         *
         * It was driven from `pointermove`, on the strength of its still
         * arriving after a refusal while `touchmove` stops. It does
         * arrive — and under `touch-action: none` its coordinates stop
         * advancing: measured, four moves all reporting clientY 282
         * while the finger had travelled 136 pixels sideways. So
         * `resolve` was asked the same question four times, answered
         * "where it already is" every time, and the card went back.
         *
         * `touchmove` is the one event that still knows where the finger
         * is, so it both refuses the pan and carries the card.
         */
        const o = from.current
        if (o) {
          const spot = fns.current.resolve(t.clientX, t.clientY, o.id, t.clientY - (o.y - o.rect.top) + o.rect.height / 2, o.rect.height)
          put({
            id: o.id,
            x: t.clientX,
            y: t.clientY,
            grabX: o.x - o.rect.left,
            grabY: o.y - o.rect.top,
            w: o.rect.width,
            h: o.rect.height,
            spot: spot ?? live.current?.spot ?? null,
            settling: false,
            touch: true,
          })
        }
      }
      /* Refused either way: the pan we just performed is ours, and the carry
         must not have one underneath it. */
      if (e.cancelable) e.preventDefault()
    }
    window.addEventListener('touchmove', touch, { passive: false })
    return () => window.removeEventListener('touchmove', touch)
  }, [])

  /* Escape puts it back. A gesture you cannot change your mind about halfway
     is one people start carefully rather than freely. */
  useEffect(() => {
    if (!id || settling) return
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      finish(false)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [id, settling, finish])

  /* The whole window is being dragged on, so the whole window says so — and
     stops selecting the text the pointer crosses on the way. */
  const dragging = !!id
  useEffect(() => {
    if (!dragging) return
    const b = document.body
    const cursor = b.style.cursor
    const select = b.style.userSelect
    b.style.cursor = 'grabbing'
    b.style.userSelect = 'none'
    return () => {
      b.style.cursor = cursor
      b.style.userSelect = select
    }
  }, [dragging])

  return {
    drag,
    board,
    layer,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
  }
}
