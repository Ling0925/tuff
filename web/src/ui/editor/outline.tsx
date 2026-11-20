import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { EDITOR as W } from '../../words/editor.js'

/** Between the words and the outline, and the outline's own width — 168
    since the project's column opened wider (256): at 1440 that left 212
    beside the words, and the outline asked 224 and went. */
const GAP = 32
const WIDTH = 168

type Head = { level: number; text: string; at: number }

/** A body's own headings, in order: what the outline lists. */
export function headingsOf(body: unknown): Head[] {
  const blocks = (body as { content?: unknown[] } | null)?.content
  if (!Array.isArray(blocks)) return []
  const out: Head[] = []
  let at = 0
  for (const b of blocks) {
    const n = b as { type?: string; attrs?: { level?: unknown }; content?: { text?: unknown }[] }
    if (n?.type !== 'heading') continue
    const text = (n.content ?? [])
      .map((t) => (typeof t?.text === 'string' ? t.text : ''))
      .join('')
      .trim()
    /* `at` counts every heading, empty ones too, because it finds the
       heading on the page by its place among them. */
    if (text) out.push({ level: Math.min(3, Math.max(1, Number(n.attrs?.level) || 1)), text, at })
    at++
  }
  return out
}

/** The frame that scrolls, and the column the words are in. */
function partsOf(self: HTMLElement | null) {
  const column = self?.parentElement ?? null
  let scroller = column?.parentElement ?? null
  while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement
  return { column, scroller }
}

/** The headings on the page, empty ones too, in order. */
const onPage = (column: HTMLElement | null) => Array.from(column?.querySelectorAll('.ProseMirror > :is(h1, h2, h3)') ?? []) as HTMLElement[]

/**
 * The headings of a long document, beside it.
 *
 * Drawn inside the document's column but out of its flow, in the room to
 * its right: appearing or going never moves a line of the words. Only with
 * two headings or more, and only where the frame has room for it beside the
 * column; read from the body, so it is whole on the frame the words are.
 */
export function Outline({ body }: { body: unknown }) {
  const heads = useMemo(() => headingsOf(body), [body])
  const self = useRef<HTMLDivElement | null>(null)
  const [room, setRoom] = useState(false)
  const [now, setNow] = useState(0)
  const enough = heads.length >= 2

  const parts = () => partsOf(self.current)

  useLayoutEffect(() => {
    if (!enough) return
    const { column, scroller } = partsOf(self.current)
    if (!column || !scroller) return
    const measure = () => {
      const right = scroller.getBoundingClientRect().left + scroller.clientWidth
      setRoom(right - column.getBoundingClientRect().right >= GAP + WIDTH + 12)
    }
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(scroller)
    watch.observe(column)
    return () => watch.disconnect()
  }, [enough])

  /*
   * A heading pressed keeps the mark: while the frame travels to it, so the
   * headings passed on the way do not flicker through it, and where it
   * stopped — a heading near the foot cannot reach the top, and the page's
   * own answer there would be another one. Moved from there, by a hand or
   * anything else, the page says again.
   */
  const pinned = useRef<{ until: number; top: number | null; target: number } | null>(null)

  /* The one being read: the last whose top has gone past the frame's top,
     or the first while none has. Scrolled to the very end, the last one in
     view. */
  useEffect(() => {
    if (!enough || !room) return
    const { column, scroller } = partsOf(self.current)
    if (!column || !scroller) return
    const look = () => {
      const pin = pinned.current
      if (pin) {
        const travelling = pin.top === null && Date.now() < pin.until
        const there = pin.top !== null && Math.abs(scroller.scrollTop - pin.top) < 4
        if (travelling || there) return
        pinned.current = null
      }
      const frame = scroller.getBoundingClientRect()
      const end = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2
      const line = end ? frame.bottom : frame.top + 24
      const found = onPage(column)
      let at = 0
      heads.forEach((h, i) => {
        const el = found[h.at]
        if (el && el.getBoundingClientRect().top <= line) at = i
      })
      setNow(at)
    }
    /* The travel is over: where it stopped is the pressed heading's. */
    const stopped = () => {
      const pin = pinned.current
      /* Only if it got there: a travel cut short by another scroll is not
         the pressed heading's place. */
      if (pin && pin.top === null && Math.abs(scroller.scrollTop - pin.target) < 4) pin.top = scroller.scrollTop
      else {
        pinned.current = null
        look()
      }
    }
    const hand = () => {
      pinned.current = null
      look()
    }
    look()
    scroller.addEventListener('scroll', look, { passive: true })
    scroller.addEventListener('scrollend', stopped)
    scroller.addEventListener('wheel', hand, { passive: true })
    return () => {
      scroller.removeEventListener('scroll', look)
      scroller.removeEventListener('scrollend', stopped)
      scroller.removeEventListener('wheel', hand)
    }
  }, [heads, enough, room])

  function go(i: number) {
    const { column, scroller } = parts()
    const el = onPage(column)[heads[i]?.at ?? -1]
    if (!el || !scroller) return
    const quiet = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const wanted = scroller.scrollTop + el.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 16
    const target = Math.max(0, Math.min(wanted, scroller.scrollHeight - scroller.clientHeight))
    scroller.scrollTo({ top: target, behavior: quiet ? 'auto' : 'smooth' })
    pinned.current = { until: Date.now() + 1000, top: null, target }
    setNow(i)
  }

  if (!enough) return null
  return (
    <div
      ref={self}
      aria-hidden={!room || undefined}
      className="pointer-events-none absolute top-0 bottom-0"
      /* With no room it is a line at the column's edge, not a box past it:
         drawn out there on a phone, the page scrolled sideways into nothing. */
      style={room ? { left: `calc(100% + ${GAP}px)`, width: WIDTH } : { left: '100%', width: 0 }}
    >
      {room && (
        <nav
          data-outline
          aria-label={W.outline}
          className="pointer-events-auto sticky top-4 flex max-h-[calc(100vh-160px)] flex-col overflow-y-auto"
        >
          {heads.map((h, i) => (
            <button
              key={`${h.at}`}
              type="button"
              data-outline-row={h.at}
              data-current={i === now || undefined}
              aria-current={i === now ? 'location' : undefined}
              onClick={() => go(i)}
              className="line-clamp-2 shrink-0 py-1 pr-2 text-left text-sm transition-colors mouse:hover:text-ink"
              style={{
                paddingLeft: 12 + (h.level - 1) * 12,
                color: i === now ? 'var(--ink)' : 'var(--ink-3)',
                boxShadow: i === now ? 'inset 2px 0 0 var(--accent)' : 'inset 1px 0 0 var(--line)',
              }}
            >
              {h.text}
            </button>
          ))}
        </nav>
      )}
    </div>
  )
}
