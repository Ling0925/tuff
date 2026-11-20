import { useCallback, useRef, useState } from 'react'

/**
 * Dragging a row up or down a list that is already on the screen.
 *
 * Not the board's drag, and deliberately a different thing. A card is carried
 * between columns and the board shows where it will land by leaving the gap
 * it would leave — which works because a column is wide and a card is tall
 * enough for the hole to read as one.
 *
 * A sidebar row is a thirty-pixel strip among identical thirty-pixel strips,
 * and the same trick there reads as the list having twitched. So this says it
 * outright: the row being carried stays where it is and goes quiet, and a
 * line is drawn in the gap it would drop into.
 *
 * The line is drawn **over** the rows and takes no space. That distinction is
 * the whole reason the board rejected one: a two-pixel line inserted into the
 * flow moved everything below it by two pixels, which changed what was under
 * the pointer, which moved the line. An overlay moves nothing.
 *
 * The threshold is the board's — a press that travels six pixels is a press,
 * and a sidebar is made of things people click.
 */
const THRESHOLD = 6

/*
 * Two more kinds of thing a list can hold, besides the rows it carries.
 *
 * A **mark** (`data-order-mark`) is a line of the list that is not a row —
 * the "Hidden" label between a sidebar's shown rooms and the ones put away.
 * It cannot be picked up, but it is counted among the rows, so the gap just
 * above it and the gap just below it are two different places to drop.
 *
 * A **target** (`data-order-target`) is a row something can be dropped *on*
 * rather than between — the "n more" at the foot of a collapsed list of
 * rooms. It is not counted among the gaps at all: while the pointer is over
 * it, it is what is lit, and there is no line.
 */

export type Reorder = {
  /** The row being carried, if any. */
  id: string | null
  /**
   * Which gap it would drop into, counted among the rows as drawn: 0 is above
   * the first row, and the length is below the last.
   */
  at: number | null
  /** The target the pointer is over, if any — it takes the place of a gap. */
  on: string | null
  handlers: {
    onPointerDown: (e: React.PointerEvent) => void
    onPointerMove: (e: React.PointerEvent) => void
    onPointerUp: (e: React.PointerEvent) => void
    onPointerCancel: (e: React.PointerEvent) => void
  }
}

export function useReorder({
  ids,
  enabled = true,
  onDrop,
  onDropOn,
}: {
  /** What is drawn, in order — marks included, targets not. */
  ids: string[]
  enabled?: boolean
  /**
   * The row, the one it now sits behind — null when it went to the top —
   * and the gap itself, counted in `ids`, for a list with a mark in it.
   */
  onDrop: (id: string, after: string | null, at: number) => void
  /** The row, let go over a target. */
  onDropOn?: (id: string, target: string) => void
}): Reorder {
  const [live, setLive] = useState<{ id: string; at: number | null; on: string | null } | null>(null)
  const from = useRef<{
    id: string
    y: number
    pointer: number
    rows: { id: string; mid: number }[]
    targets: { id: string; top: number; bottom: number }[]
  } | null>(null)

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!enabled || e.button !== 0) return
      const target = e.target as HTMLElement
      /* Anything that is its own control is left alone, the same guard the
         list rows use: a press on a button is a press on that button. */
      if (target.closest('button[data-no-drag], input, select, a')) return
      const row = target.closest('[data-order]') as HTMLElement | null
      const box = row?.closest('[data-order-list]') as HTMLElement | null
      if (!row || !box) return
      /* Where every row is before anything moves. Measured once, because the
         list is about to start rearranging and the answer would change under
         the question. */
      const rows = [...box.querySelectorAll('[data-order], [data-order-mark]')].map((n) => {
        const r = n.getBoundingClientRect()
        const d = (n as HTMLElement).dataset
        return { id: (d.order ?? d.orderMark)!, mid: r.top + r.height / 2 }
      })
      const targets = [...box.querySelectorAll('[data-order-target]')].map((n) => {
        const r = n.getBoundingClientRect()
        return { id: (n as HTMLElement).dataset.orderTarget!, top: r.top, bottom: r.bottom }
      })
      from.current = { id: row.dataset.order!, y: e.clientY, pointer: e.pointerId, rows, targets }
    },
    [enabled],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const o = from.current
      if (!o) return
      const dy = e.clientY - o.y
      /* Below the threshold nothing has happened yet, so a click still
         reaches whatever is under it. */
      if (!live && Math.abs(dy) < THRESHOLD) return
      if (!live) (e.currentTarget as HTMLElement).setPointerCapture(o.pointer)
      /* Which gap the pointer is in, by the row middles as they were — and
         they stay as they were, because nothing moves during this gesture. */
      const on = o.targets.find((t) => e.clientY >= t.top && e.clientY < t.bottom)
      if (on) {
        setLive({ id: o.id, at: null, on: on.id })
        return
      }
      let at = o.rows.findIndex((r) => e.clientY < r.mid)
      if (at === -1) at = o.rows.length
      setLive({ id: o.id, at, on: null })
    },
    [live],
  )

  const letGo = useCallback(() => {
    const o = from.current
    const l = live
    from.current = null
    setLive(null)
    if (!o || !l) return
    if (l.on) {
      onDropOn?.(o.id, l.on)
      return
    }
    if (l.at === null) return
    /* The gap is counted among the rows as drawn, the carried row included —
       so the row it lands behind is the one above the gap, and that is itself
       when the gap is the one it already sits in. Both of those mean nothing
       happened. */
    const was = ids.indexOf(o.id)
    if (l.at === was || l.at === was + 1) return
    const above = l.at > 0 ? ids[l.at - 1]! : null
    onDrop(o.id, above === o.id ? null : above, l.at)
  }, [ids, live, onDrop, onDropOn])

  return {
    id: live?.id ?? null,
    at: live?.at ?? null,
    on: live?.on ?? null,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: letGo,
      onPointerCancel: letGo,
    },
  }
}
