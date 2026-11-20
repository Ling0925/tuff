import { useSyncExternalStore } from 'react'

/**
 * The way back from a delete made somewhere that does not stay on the
 * screen.
 *
 * The board and Docs keep their own toast, because the list they put a row
 * back into is theirs. An announcement, a comment and a channel are deleted
 * from a screen that closes on the press — the announcement's, the room's —
 * or from one row of a thread, so the offer is held here, above every
 * screen, and drawn once by the shell (`UndoToast`). The newest offer is the
 * one on screen; a newer delete takes its place, as the board's does.
 */
export type UndoOffer = {
  key: number
  said: string
  /** Puts it back: waits for the delete, asks the server, then `after`. */
  back: () => Promise<void>
}

let now: UndoOffer | null = null
let next = 0
const heard = new Set<() => void>()
const tell = () => {
  for (const f of heard) f()
}

/**
 * Offers the delete back for as long as the toast is up.
 *
 * `deleting` is the delete itself: a restore waits for it, because a quick
 * press sent ahead of it found nothing deleted, and then the delete landed.
 * `after` reads again whatever the screen shows, once it is back.
 */
export function offerUndo(said: string, deleting: Promise<unknown>, restore: () => Promise<unknown>, after?: () => unknown): void {
  const key = ++next
  now = {
    key,
    said,
    back: async () => {
      if (now?.key === key) {
        now = null
        tell()
      }
      await deleting.catch(() => null)
      await restore().catch(() => null)
      await after?.()
    },
  }
  tell()
}

/** The offer goes — its time is up, or a list's own toast now holds the newest delete. */
export function dropUndo(key?: number): void {
  if (!now || (key !== undefined && now.key !== key)) return
  now = null
  tell()
}

export function useUndoOffer(): UndoOffer | null {
  return useSyncExternalStore(
    (f) => {
      heard.add(f)
      return () => {
        heard.delete(f)
      }
    },
    () => now,
  )
}
