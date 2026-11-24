import { useSyncExternalStore } from 'react'

/**
 * How wide a thread beside its room is — `docs/specs/chat-threads.md`.
 *
 * 360 to start with, and as wide as the reader drags it, kept on
 * this machine as the columns' widths are (`useWidth`). One number for the
 * whole window rather than a state in the room: the project's bar widens
 * with the thread as one piece, and it lives in another component, so the
 * number is written to `--thread-w` on the root and every width that
 * follows it — the pane, its frame, the room's column, the bar over it — is
 * that variable in a stylesheet.
 */
export const THREAD_W = 360
export const THREAD_MIN = 320
export const THREAD_MAX = 560
/**
 * What the room keeps beside a thread: a short line, but a line, and the
 * gap between the two. The room goes under the thread below this.
 */
export const ROOM_KEEPS = 460

const KEY = 'thread-width'
const heard = new Set<() => void>()

const read = (): number => {
  try {
    const saved = Number(localStorage.getItem(KEY))
    return saved >= THREAD_MIN && saved <= THREAD_MAX ? saved : THREAD_W
  } catch {
    // Private window, blocked storage: the default is a fine answer.
    return THREAD_W
  }
}

let now = read()
/* Not on the server that pre-renders the site, which has no document. */
const apply = () => {
  if (typeof document !== 'undefined') document.documentElement.style.setProperty('--thread-w', `${now}px`)
}
apply()

export function setThreadWidth(next: number): void {
  const held = Math.min(THREAD_MAX, Math.max(THREAD_MIN, Math.round(next)))
  if (held === now) return
  now = held
  apply()
  try {
    localStorage.setItem(KEY, String(held))
  } catch {
    // Nothing to do and nothing to say: the thread still moved.
  }
  for (const f of heard) f()
}

export function useThreadWidth(): number {
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

/**
 * Held in the hand: the frame, the pane and the bar follow the pointer
 * rather than their own 200 ms ease, which would trail behind it.
 */
export function threadDragging(on: boolean): void {
  if (on) document.documentElement.setAttribute('data-thread-dragging', '')
  else document.documentElement.removeAttribute('data-thread-dragging')
}
