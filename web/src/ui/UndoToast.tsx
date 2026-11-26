import { useEffect, useRef, useState } from 'react'
import { ACTS } from '../data/words.js'
import { isKey } from '../data/keys.js'
import { dropUndo, useUndoOffer } from '../data/undo.js'
import { Glass } from './Glass.jsx'

/**
 * How long the way back is offered.
 *
 * Ten seconds, and the clock stands still while the pointer is on the
 * toast or the keyboard is in it. It was thirty, and thirty is long enough
 * that the toast reads as something left on the screen rather than a
 * moment to change your mind: we asked for it to go. Ten
 * is Gmail's longer setting, and the slip it is there for is the one
 * noticed at once; a hand already reaching for Undo stops the clock.
 */
export const UNDO_MS = 10_000

/** How long it takes to arrive and to leave — the same path both ways. */
const MOVE_MS = 200

/**
 * The toast at the foot that offers a delete back, for every place that
 * deletes: the board's, Docs' and the shell's (`UndoToast`) are this one
 * component, so they come, wait and go the same way.
 *
 * It keeps the offer it last showed for the fifth of a second it takes to
 * leave, so it goes the way it came instead of vanishing — and stops being
 * `[data-undo-toast]` at once, since from that moment there is nothing on
 * it to press.
 */
export function UndoBar({
  offer,
  onUndo,
  onGone,
}: {
  /** What is offered back, or null for nothing. A new `key` is a new offer and a fresh clock. */
  offer: { key: string; said: string } | null
  onUndo: () => void
  /** The time is up. */
  onGone: () => void
}) {
  const [last, setLast] = useState(offer)
  const [held, setHeld] = useState(false)
  const gone = useRef(onGone)
  gone.current = onGone

  const key = offer?.key ?? null
  const said = offer?.said ?? ''
  // biome-ignore lint/correctness/useExhaustiveDependencies: the offer is a new object each render; its key and words are what change
  useEffect(() => {
    if (key !== null) {
      setLast({ key, said })
      return
    }
    const t = setTimeout(() => setLast(null), MOVE_MS)
    return () => clearTimeout(t)
  }, [key, said])

  useEffect(() => {
    if (key === null || held) return
    const t = setTimeout(() => gone.current(), UNDO_MS)
    return () => clearTimeout(t)
  }, [key, held])

  const shown = offer ?? last
  if (!shown) return null
  const leaving = !offer
  return (
    <div
      {...(leaving ? {} : { 'data-undo-toast': '' })}
      className="fixed left-1/2 z-50 -translate-x-1/2"
      /* Above a phone's tabs, which are at the foot too. */
      style={{ bottom: 'calc(24px + var(--foot))' }}
      role="status"
    >
      <div
        className="undo-bar"
        data-leaving={leaving || undefined}
        onPointerEnter={() => setHeld(true)}
        onPointerLeave={() => setHeld(false)}
        onFocus={() => setHeld(true)}
        onBlur={() => setHeld(false)}
      >
        <Glass radius={16} className="flex items-center gap-4 py-2 pr-2 pl-4">
          <span className="max-w-[320px] truncate text-base text-ink">{shown.said}</span>
          <button
            type="button"
            {...(leaving ? {} : { 'data-testid': 'undo-delete' })}
            tabIndex={leaving ? -1 : undefined}
            onClick={onUndo}
            className="flex h-8 shrink-0 items-center px-3 text-base font-medium text-accent"
            style={{ borderRadius: 'var(--r-pill)' }}
          >
            {ACTS.undo}
          </button>
        </Glass>
      </div>
    </div>
  )
}

/**
 * The way back from a delete, drawn once by the shell.
 *
 * The same toast the board and Docs draw, at the foot and over everything,
 * saying what went. Up for `UNDO_MS`, and ⌘Z takes it back while it is up —
 * by the key and not the letter, never while somebody is typing (a field's
 * own undo is the one they mean there) nor under a dialog. Heard before the
 * board's own ⌘Z and stopped there: one press takes back one thing, and the
 * thing on the screen saying "Undo" is the one it means.
 */
export function UndoToast() {
  const offer = useUndoOffer()

  useEffect(() => {
    if (!offer) return
    const onKey = (e: KeyboardEvent) => {
      if (!isKey(e, 'z') || !(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return
      const el = e.target as HTMLElement | null
      if (el?.isContentEditable) return
      if (el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return
      if (document.querySelector('[role="dialog"]')) return
      e.preventDefault()
      e.stopImmediatePropagation()
      void offer.back()
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [offer])

  return (
    <UndoBar
      offer={offer && { key: String(offer.key), said: offer.said }}
      onUndo={() => void offer?.back()}
      onGone={() => offer && dropUndo(offer.key)}
    />
  )
}
