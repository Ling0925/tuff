import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/**
 * The room a list's unread tasks will take, under the ones drawn — and the
 * moment to read them, which is when that room comes within a screen of
 * being seen.
 *
 * Room rather than a row that says "more": the column's scroll says how
 * long the list really is, and what arrives fills space that was already
 * there instead of pushing anything. Its height is the count times the
 * distance between the rows already drawn, measured before the frame is
 * painted, so the guess is the screen's own and not a number written here.
 */
export function Unread({
  count,
  of,
  what,
  guess,
  onNear,
}: {
  /** How many are not read yet. */
  count: number
  /** The box that scrolls them. */
  of: { current: HTMLElement | null }
  /** What one drawn row is, to measure the room by. */
  what: string
  /** The distance between two rows, until there are two to measure. */
  guess: number
  onNear: () => void
}) {
  const me = useRef<HTMLDivElement>(null)
  const [pitch, setPitch] = useState(guess)
  // biome-ignore lint/correctness/useExhaustiveDependencies: measured again whenever the count changes, which is when rows were drawn above it
  useLayoutEffect(() => {
    const parent = me.current?.parentElement
    if (!parent) return
    const rows = [...parent.querySelectorAll<HTMLElement>(what)].map((el) => el.getBoundingClientRect()).filter((r) => r.height > 0)
    if (rows.length < 2) return
    const each = (rows[rows.length - 1]!.top - rows[0]!.top) / (rows.length - 1)
    if (each > 0 && Math.abs(each - pitch) >= 1) setPitch(Math.round(each))
  }, [count, what])
  const near = useRef(onNear)
  near.current = onNear
  /* A new watch for every count: one that is still in sight after a page
     lands says so on its first answer and reads the next. */
  useEffect(() => {
    const el = me.current
    if (!el || count === 0) return
    const box = of.current
    const root = box && /(auto|scroll)/.test(getComputedStyle(box).overflowY) ? box : null
    const watch = new IntersectionObserver((seen) => seen.some((e) => e.isIntersecting) && near.current(), {
      root,
      rootMargin: '0px 0px 100% 0px',
    })
    watch.observe(el)
    return () => watch.disconnect()
  }, [count, of])
  return <div ref={me} aria-hidden data-unread={count} className="shrink-0" style={{ height: count * pitch }} />
}
