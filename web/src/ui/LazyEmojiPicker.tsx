import { lazy, Suspense } from 'react'
import { soonEmoji } from '../data/emoji.js'

/**
 * The picker, in a chunk of its own — `docs/specs/emoji.md`.
 *
 * Its code and the grid it draws with are fetched with the list, when a
 * line to write on is on the screen and the machine is idle, so it is here
 * before the first press and the app's own bundle does not carry it. Opened
 * before it has come, the frame it will fill is drawn at its size.
 */
let coming: Promise<{ default: typeof import('./EmojiPicker.jsx').EmojiPicker }> | null = null
function load() {
  coming ??= import('./EmojiPicker.jsx').then((m) => ({ default: m.EmojiPicker }))
  return coming
}
const Picker = lazy(load)

/** A line to write on is drawn: ask for the picker and the list when idle. */
export function soonPicker(): void {
  soonEmoji()
  if (coming) return
  const go = () => void load().catch(() => (coming = null))
  if ('requestIdleCallback' in window) window.requestIdleCallback(go, { timeout: 4000 })
  else setTimeout(go, 1500)
}

/** The picker's own height: its search, its tabs, the grid and the name band. */
export const PICKER_HEIGHT = 417

export function EmojiPicker(props: { onPick: (emoji: string) => void; autoFocus?: boolean }) {
  return (
    <Suspense fallback={<div aria-hidden style={{ height: PICKER_HEIGHT, maxHeight: 'inherit' }} />}>
      <Picker {...props} />
    </Suspense>
  )
}
