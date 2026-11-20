import { useSyncExternalStore } from 'react'

/**
 * What is on its way to the server, while it is on its way.
 *
 * A picture put into a body is drawn the moment it is chosen, from the file
 * the browser already holds, and sent behind it; the document holds a node
 * with no file id yet and the id of its send, and this holds the rest —
 * the picture to draw, how far the send has got, and the way to stop it.
 * Kept out of the document because none of it may be saved: a document
 * with a blob link in it is a broken picture for everybody else.
 *
 * Once sent, the picture the browser drew from is kept by file id for the
 * rest of the visit, so the screen goes on showing the bytes it already has
 * rather than blinking to the same picture fetched back.
 */
type Sending = { preview: string | null; progress: number; abort?: () => void }

const now = new Map<string, Sending>()
const shown = new Map<string, string>()
const heard = new Set<() => void>()
const tell = () => heard.forEach((f) => f())

export function begin(id: string, preview: string | null): void {
  now.set(id, { preview, progress: 0 })
  tell()
}

export function progress(id: string, fraction: number): void {
  const s = now.get(id)
  if (!s) return
  now.set(id, { ...s, progress: fraction })
  tell()
}

export function abortable(id: string, abort: () => void): void {
  const s = now.get(id)
  if (s) now.set(id, { ...s, abort })
}

/** Sent: the picture stays, under the file it became. */
export function done(id: string, fileId: string | null): void {
  const s = now.get(id)
  now.delete(id)
  if (s?.preview && fileId) shown.set(fileId, s.preview)
  else if (s?.preview) URL.revokeObjectURL(s.preview)
  tell()
}

/** Taken out before it arrived: the send stops. */
export function cancel(id: string): void {
  now.get(id)?.abort?.()
  done(id, null)
}

/**
 * A file sent from a strip rather than an editor — a message, a comment —
 * whose bytes the sender already holds. They see their own picture at once
 * instead of waiting on it, and on a blur of it, from the server.
 */
export function held(fileId: string, preview: string): void {
  shown.set(fileId, preview)
}

export function previewOf(fileId: string | null): string | null {
  return fileId ? (shown.get(fileId) ?? null) : null
}

export function useSending(id: string | null): Sending | null {
  return useSyncExternalStore(
    (f) => {
      heard.add(f)
      return () => heard.delete(f)
    },
    () => (id ? (now.get(id) ?? null) : null),
  )
}
