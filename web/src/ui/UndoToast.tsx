import { useEffect } from 'react'
import { ACTS } from '../data/words.js'
import { isKey } from '../data/keys.js'
import { dropUndo, useUndoOffer } from '../data/undo.js'
import { Glass } from './Glass.jsx'

/**
 * The way back from a delete, drawn once by the shell.
 *
 * The same toast the board and Docs draw, at the foot and over everything,
 * saying what went. Thirty seconds, and ⌘Z takes it back while it is up —
 * by the key and not the letter, never while somebody is typing (a field's
 * own undo is the one they mean there) nor under a dialog. Heard before the
 * board's own ⌘Z and stopped there: one press takes back one thing, and the
 * thing on the screen saying "Undo" is the one it means.
 */
export function UndoToast() {
  const offer = useUndoOffer()

  useEffect(() => {
    if (!offer) return
    const t = setTimeout(() => dropUndo(offer.key), 30_000)
    return () => clearTimeout(t)
  }, [offer])

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

  if (!offer) return null
  return (
    <div
      data-undo-toast
      className="fixed left-1/2 z-50 -translate-x-1/2"
      /* Above a phone's tabs, which are at the foot too. */
      style={{ bottom: 'calc(24px + var(--foot))' }}
      role="status"
    >
      <Glass radius={16} className="flex items-center gap-4 py-2 pr-2 pl-4">
        <span className="max-w-[320px] truncate text-base text-ink">{offer.said}</span>
        <button
          type="button"
          data-testid="undo-delete"
          onClick={() => void offer.back()}
          className="flex h-8 shrink-0 items-center px-3 text-base font-medium text-accent"
          style={{ borderRadius: 'var(--r-pill)' }}
        >
          {ACTS.undo}
        </button>
      </Glass>
    </div>
  )
}
