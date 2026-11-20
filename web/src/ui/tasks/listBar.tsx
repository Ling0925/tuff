import { useState, useRef, useCallback, useEffect } from 'react'

/**
 * The list's own scrollbar, drawn beside the panel rather than inside it.
 *
 * The browser's bar is part of the box it scrolls: styled, it is not an
 * overlay, so it takes real width out of the content — which is how a band's
 * shade came to stop twelve pixels short of the panel it was painted on. The
 * gutter was reserved to stop that width appearing and disappearing, and
 * reserving it is what pushed everything inside away from the edge.
 *
 * Whether it takes width at all depends on the machine. With "Always show
 * scrollbars" set, macOS gives every styled bar a real track; with the
 * default it gives an overlay that takes none. So the same CSS draws two
 * different layouts, and the one this was tested on was the one without the
 * problem.
 *
 * Drawn here, none of that applies. The pane hides the browser's bar
 * entirely and this stands in the gap beside it — outside the panel, in the
 * gutter the column already has — so the sheet, the rows and the band strips
 * run to the panel's own edge on every machine and whatever the setting.
 *
 * It is `BoardBar` turned on its side, and deliberately the same: the same
 * two shades, the same press-beside-to-jump, the same pointer capture so the
 * drag survives the hand sliding off a bar four pixels wide.
 */
export function ListBar({
  of,
  over = false,
  outside = false,
}: {
  of: React.RefObject<HTMLDivElement | null>
  /**
   * Floated on top of the pane instead of standing beside it.
   *
   * The list gives the bar a column of its own, which is the honest
   * arrangement: it takes twelve pixels and nothing is ever drawn under it.
   * A board column cannot pay that — 256 pixels at its narrowest with five
   * on the screen, so five bars in five gutters is a strip of furniture
   * between every pair of cards.
   *
   * Over the cards it costs no width at all. The price is that it is drawn
   * on top of them, which is why it is only there while the pointer is in
   * that column: the rest of the time a column is cards and nothing else.
   */
  over?: boolean
  /**
   * Floated, but just outside the pane rather than on top of it.
   *
   * The list has a twenty-four pixel margin around its work — the tool
   * body's own padding — and the bar fits in it with room to spare. So it
   * costs the sheet nothing *and* is never drawn over a row, which is the
   * arrangement a column cannot have because a column has no margin to
   * spare.
   */
  outside?: boolean
}) {
  /** Both as fractions of the whole height, so the track's size is irrelevant. */
  const [at, setAt] = useState<{ top: number; height: number } | null>(null)
  const track = useRef<HTMLDivElement>(null)
  const grab = useRef<{ y: number; top: number } | null>(null)

  const measure = useCallback(() => {
    const b = of.current
    if (!b) return
    /* A pixel of slack: a pane that overflows by less than one is a rounding
       error, and a pill the full height of the track says "there is more"
       when there is not. */
    if (b.scrollHeight - b.clientHeight < 1) return setAt(null)
    setAt({ top: b.scrollTop / b.scrollHeight, height: b.clientHeight / b.scrollHeight })
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
    /* Two different things change what this shows: the pane's own size, and
       how much is inside it. A band being folded is the second, and a resize
       observer on the box alone never hears about it. */
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

  const onDown = (e: React.PointerEvent) => {
    const b = of.current
    const t = track.current
    if (!b || !t || !at) return
    t.setPointerCapture(e.pointerId)
    const box = t.getBoundingClientRect()
    const thumb = { top: box.top + at.top * box.height, height: at.height * box.height }
    const onThumb = e.clientY >= thumb.top && e.clientY <= thumb.top + thumb.height
    if (!onThumb) {
      b.scrollTop = ((e.clientY - box.top - thumb.height / 2) / box.height) * b.scrollHeight
    }
    grab.current = { y: e.clientY, top: b.scrollTop }
  }

  const onMove = (e: React.PointerEvent) => {
    const b = of.current
    const t = track.current
    const from = grab.current
    if (!b || !t || !from) return
    e.preventDefault()
    const box = t.getBoundingClientRect()
    b.scrollTop = from.top + ((e.clientY - from.y) / box.height) * b.scrollHeight
  }

  const letGo = () => {
    grab.current = null
  }

  return (
    <div
      ref={track}
      data-list-bar
      /* Shown by hovering its column — `[data-col-reveal]` in `theme.css`. */
      data-col-reveal={over && !outside ? '' : undefined}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={letGo}
      onPointerCancel={letGo}
      className={
        over
          ? /* Inside the pane's padding, against its right edge, and above
               the cards. `opacity` rather than unrendering, so the thumb
               does not jump into existence under a hand already moving
               toward it. */
            /* The track takes no presses, only the thumb does — see the
               note on the thumb below. */
            [
              'pointer-events-none absolute top-0 bottom-0 z-10 w-3 transition-opacity',
              /*
               * Beside the cards, never across them.
               *
               * It was at `right-1`, which is inside the scroller: the pill
               * then ran down the right-hand end of every card it passed,
               * which is what a scrollbar over content looks like when the
               * content is opaque.
               *
               * A column pays `p-2` on each side, and twelve out puts the
               * bar entirely in that padding and the board's own gap beside
               * it — clear of the cards, and still reading as this column's
               * rather than as something between two of them. Eight left the
               * pill touching the cards' corner; the four after that is the
               * difference between beside and against. The list has the tool
               * body's twenty-four to sit in and takes twelve of them.
               */
              '-right-3',
              /* A column's bar is shown by hovering the column; the list's
                 by hovering the pane, which is what `peer` cannot reach
                 across — so it is simply always there, faint, the way a
                 scrollbar beside a long list has always been. */
              outside ? '' : 'opacity-0',
            ].join(' ')
          : 'relative ml-1 w-3 shrink-0'
      }
      style={{ touchAction: 'none' }}
    >
      {at && (
        <div
          data-list-thumb
          /*
           * Floated, only the pill answers the pointer.
           *
           * Beside the content the whole track is pressable, and pressing
           * the empty part of it jumps the pane to there — a real
           * convenience that costs nothing, because nothing else is under
           * it. Over the cards it is not free: the track runs the full
           * height of the column against its right edge, so every press
           * near a card's right-hand side landed on the bar instead of the
           * card. A test caught it by clicking fourteen pixels in from a
           * card's corner and getting no task.
           *
           * So the track is transparent to the pointer there and the thumb
           * takes presses on its own. The jump goes with it, which is the
           * right trade: a card that does not open when pressed is a bug,
           * and a bar you have to grab by the pill is a scrollbar.
           */
          className={
            over
              ? 'pointer-events-auto absolute left-1/2 w-1 -translate-x-1/2 transition-colors'
              : 'absolute left-1/2 w-1 -translate-x-1/2 transition-colors'
          }
          style={{
            top: `${at.top * 100}%`,
            height: `${at.height * 100}%`,
            borderRadius: 999,
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
