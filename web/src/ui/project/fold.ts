import { useSyncExternalStore } from 'react'
import { COLUMN_MS } from '../kit.jsx'

/**
 * Whether the project's column is folded into the sidebar, and where it
 * folds to.
 *
 * Two components that never meet need both answers: the project screen,
 * which draws the column or does not, and the sidebar, which holds the place
 * under the open project's row where the tools go instead. So they are kept
 * here rather than in either, the way `data/memory.ts` keeps what both sides
 * of a navigation read.
 */

const KEY = 'tools-width-shut'

type State = {
  /** The person's choice, kept on this machine like the columns' widths. */
  folded: boolean
  /** Travelling between the two, so the widths ease rather than jump. */
  moving: boolean
  /** The place under the open project's row, while the sidebar draws one. */
  slot: HTMLElement | null
}

let state: State = {
  folded: (() => {
    try {
      return localStorage.getItem(KEY) === '1'
    } catch {
      return false
    }
  })(),
  moving: false,
  slot: null,
}

const heard = new Set<() => void>()
const tell = (next: Partial<State>) => {
  state = { ...state, ...next }
  for (const f of heard) f()
}
let settle: ReturnType<typeof setTimeout> | null = null

/**
 * Fold or unfold. `key` when a keyboard said it — a key's answer is not
 * animated.
 */
export function fold(yes: boolean, key = false) {
  if (settle) clearTimeout(settle)
  tell({ folded: yes, moving: !key })
  if (!key) settle = setTimeout(() => tell({ moving: false }), COLUMN_MS + 40)
  try {
    localStorage.setItem(KEY, yes ? '1' : '0')
  } catch {
    // A private window: folded now, open again tomorrow.
  }
}

/**
 * The sidebar's ref on the place under the open project. Given back only by
 * the element that holds it, so a cleanup that arrives after the next
 * project's place has been taken cannot undo it.
 */
export function foldSlot(el: HTMLElement | null) {
  if (!el) return
  if (state.slot !== el) tell({ slot: el })
  return () => {
    if (state.slot === el) tell({ slot: null })
  }
}

/** Whether a press came from a key: a click a key made has no pointer. */
export const byKey = (e: React.MouseEvent) => e.detail === 0

export function useFold(): State {
  return useSyncExternalStore(
    (f) => {
      heard.add(f)
      return () => heard.delete(f)
    },
    () => state,
  )
}
